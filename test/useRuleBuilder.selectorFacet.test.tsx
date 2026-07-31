import { afterEach, describe, expect, test } from 'bun:test';
import type { Condition, FieldMap } from '@inixiative/json-rules';
import { act, cleanup, renderHook } from '@testing-library/react';
import type { ArrayNode, GroupNode } from '../src/builder/buildNodes';
import { useRuleBuilder } from '../src/builder/useRuleBuilder';
import type { Decoration } from '../src/schema/decoration';

afterEach(cleanup);

// A selector-backed facet (a survey question, a badge name) has identity the
// `where` machinery can't know about: the picked clause is USER data, yet lives
// in the same group as the user's rows. Before this, the group's ALL/ANY toggle
// re-keyed the whole group — `{ any: [question, answerA, answerB] }` — silently
// turning "answered THE question with one of these" into "answered it at all,
// OR gave any of these answers" (the Cisco Survey Responses corruption). The
// canonical shape now hoists the selector clause next to the fixed `where`:
// `{ all: [...where, ...selector clauses, { all|any: rows }] }`.

const surveyMap: FieldMap = {
  models: {
    User: {
      fields: {
        surveys: { kind: 'object', type: 'Survey', isList: true },
      },
    },
    Survey: {
      fields: {
        answer: { kind: 'scalar', type: 'String' },
        approved: { kind: 'scalar', type: 'Boolean' },
        question: { kind: 'object', type: 'Question' },
      },
    },
    Question: {
      fields: {
        title: { kind: 'scalar', type: 'String' },
      },
    },
  },
};
const surveySource = { maps: { app: surveyMap }, mapName: 'app', model: 'User' };

const surveyView: Decoration = {
  facets: [
    {
      path: 'surveys',
      label: 'Survey Responses',
      selectors: [{ field: 'question.title', label: 'Question', anyLabel: 'Any question' }],
    },
  ],
};

const question = (value: string): Condition =>
  ({ field: 'question.title', operator: 'equals', value }) as Condition;
const answer = (value: string): Condition =>
  ({ field: 'answer', operator: 'equals', value }) as Condition;

const saved = (condition: Condition): Condition =>
  ({
    all: [{ field: 'surveys', arrayOperator: 'any', condition } as Condition],
  }) as Condition;

const rootGroup = (r: { root: unknown }) => r.root as GroupNode;
const facetNode = (r: { root: unknown }) => rootGroup(r).children[0] as ArrayNode;
const savedNode = (r: { value: unknown }) =>
  (r.value as { all: Condition[] }).all[0] as {
    condition: { all?: Condition[]; any?: Condition[] };
  };

describe('selector-backed facet — the picked clause is identity', () => {
  test('ingest normalizes a flat tree: selector clause leading, rows in their own group', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: surveyView,
        defaultValue: saved({ all: [question('Q1'), answer('A'), answer('B')] } as Condition),
      }),
    );
    expect(savedNode(result.current).condition).toEqual({
      all: [
        expect.objectContaining(question('Q1')),
        { all: [expect.objectContaining(answer('A')), expect.objectContaining(answer('B'))] },
      ],
    });
    // The rows group is the whole editable surface; the clause is reachable only
    // through the dedicated selector leaves.
    const node = facetNode(result.current);
    expect(node.condition?.children).toHaveLength(2);
    expect(node.selectorClauses).toHaveLength(1);
    expect(node.selectorClauses?.[0]?.field?.value).toBe('question.title');
    expect(node.selectorClauses?.[0]?.value?.current).toBe('Q1');
  });

  test('toggling ANY nests only the rows; the selector clause stays a leading AND', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: surveyView,
        defaultValue: saved({ all: [question('Q1'), answer('A'), answer('B')] } as Condition),
      }),
    );
    act(() => facetNode(result.current).condition?.operator.set('any'));
    expect(savedNode(result.current).condition).toEqual({
      all: [
        expect.objectContaining(question('Q1')),
        { any: [expect.objectContaining(answer('A')), expect.objectContaining(answer('B'))] },
      ],
    });
  });

  test('picking a question AFTER toggling ANY conjoins it outside the any group (the second entry point)', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: surveyView,
        defaultValue: saved({ any: [answer('A'), answer('B')] } as Condition),
      }),
    );
    act(() => facetNode(result.current).setSelectorClause?.('question.title', 'Q1'));
    expect(savedNode(result.current).condition).toEqual({
      all: [
        expect.objectContaining(question('Q1')),
        { any: [expect.objectContaining(answer('A')), expect.objectContaining(answer('B'))] },
      ],
    });
  });

  test('setSelectorClause replaces in place and removing it unwraps the rows group', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: surveyView,
        defaultValue: saved({
          all: [question('Q1'), { any: [answer('A')] } as Condition],
        } as Condition),
      }),
    );
    act(() => facetNode(result.current).setSelectorClause?.('question.title', 'Q2'));
    expect(savedNode(result.current).condition).toEqual({
      all: [
        expect.objectContaining(question('Q2')),
        { any: [expect.objectContaining(answer('A'))] },
      ],
    });

    act(() => facetNode(result.current).setSelectorClause?.('question.title', null));
    expect(savedNode(result.current).condition).toEqual({
      any: [expect.objectContaining(answer('A'))],
    });
  });

  test('a rows-only facet has no identity to protect — the toggle honestly re-keys the group', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: surveyView,
        defaultValue: saved({ all: [answer('A'), answer('B')] } as Condition),
      }),
    );
    act(() => facetNode(result.current).condition?.operator.set('any'));
    expect(savedNode(result.current).condition).toEqual({
      any: [expect.objectContaining(answer('A')), expect.objectContaining(answer('B'))],
    });
  });

  test('an already-corrupted any tree is matched but NOT silently rewritten — repair is a migration', () => {
    const corrupted = saved({ any: [question('Q1'), answer('A')] } as Condition);
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: surveyView,
        defaultValue: corrupted,
      }),
    );
    // Inside an `any` the clause is a disjunct — its meaning is already changed,
    // so a silent load-time rewrite would alter what the saved rule matches.
    expect(savedNode(result.current).condition).toEqual({
      any: [expect.objectContaining(question('Q1')), expect.objectContaining(answer('A'))],
    });
    expect(facetNode(result.current).selectorClauses).toBeUndefined();
  });
});

describe('selector-backed facet with a fixed where — both identity kinds hoist', () => {
  const mixedView: Decoration = {
    facets: [
      {
        path: 'surveys',
        where: { field: 'approved', operator: 'equals', value: true },
        label: 'Approved Survey Responses',
        selectors: [{ field: 'question.title', label: 'Question', anyLabel: 'Any question' }],
      },
    ],
  };
  const where = { field: 'approved', operator: 'equals', value: true };

  test('toggle keeps the where AND the selector clause out of the rows group', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: mixedView,
        defaultValue: saved({
          all: [where as Condition, question('Q1'), answer('A'), answer('B')],
        } as Condition),
      }),
    );
    act(() => facetNode(result.current).condition?.operator.set('any'));
    expect(savedNode(result.current).condition).toEqual({
      all: [
        expect.objectContaining(where),
        expect.objectContaining(question('Q1')),
        { any: [expect.objectContaining(answer('A')), expect.objectContaining(answer('B'))] },
      ],
    });
    const node = facetNode(result.current);
    expect(node.selectorClauses).toHaveLength(1);
    expect(node.selectorClauses?.[0]?.value?.current).toBe('Q1');
  });
});

describe('the write seam never touches a disjunct (adversarial findings)', () => {
  test('picking on an any tree conjoins outside — the disjunct stays a visible row', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: surveyView,
        defaultValue: saved({ any: [question('Q1'), answer('A')] } as Condition),
      }),
    );
    act(() => facetNode(result.current).setSelectorClause?.('question.title', 'Q2'));
    expect(savedNode(result.current).condition).toEqual({
      all: [
        expect.objectContaining(question('Q2')),
        { any: [expect.objectContaining(question('Q1')), expect.objectContaining(answer('A'))] },
      ],
    });
  });

  test('clearing on an any tree is a no-op — a disjunct is not the selector clause', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: surveyView,
        defaultValue: saved({ any: [question('Q1'), answer('A')] } as Condition),
      }),
    );
    const before = JSON.stringify(result.current.value);
    act(() => facetNode(result.current).setSelectorClause?.('question.title', null));
    expect(JSON.stringify(result.current.value)).toBe(before);
  });
});

describe('complex selectors — an internal OR is the selector clause as its own block', () => {
  test('an OR block on the selector field hoists; the rows toggle cannot absorb it', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: surveyView,
        defaultValue: saved({
          all: [{ any: [question('Q1'), question('Q2')] } as Condition, answer('A')],
        } as Condition),
      }),
    );
    expect(savedNode(result.current).condition).toEqual({
      all: [
        { any: [expect.objectContaining(question('Q1')), expect.objectContaining(question('Q2'))] },
        { all: [expect.objectContaining(answer('A'))] },
      ],
    });
    const node = facetNode(result.current);
    expect(node.selectorClauses).toHaveLength(1);
    expect(node.selectorClauses?.[0]?.kind).toBe('group');
    act(() => facetNode(result.current).condition?.operator.set('any'));
    expect(savedNode(result.current).condition).toEqual({
      all: [
        { any: [expect.objectContaining(question('Q1')), expect.objectContaining(question('Q2'))] },
        { any: [expect.objectContaining(answer('A'))] },
      ],
    });
  });

  test('re-picking replaces the whole block; an array value writes an in clause', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: surveyView,
        defaultValue: saved({
          all: [{ any: [question('Q1'), question('Q2')] } as Condition, answer('A')],
        } as Condition),
      }),
    );
    act(() => facetNode(result.current).setSelectorClause?.('question.title', 'Q3'));
    expect(savedNode(result.current).condition).toEqual({
      all: [
        expect.objectContaining(question('Q3')),
        { all: [expect.objectContaining(answer('A'))] },
      ],
    });
    act(() => facetNode(result.current).setSelectorClause?.('question.title', ['Q4', 'Q5']));
    expect(savedNode(result.current).condition).toEqual({
      all: [
        expect.objectContaining({ field: 'question.title', operator: 'in', value: ['Q4', 'Q5'] }),
        { all: [expect.objectContaining(answer('A'))] },
      ],
    });
  });
});

describe('branch facet with selectors — identity hoists and the graft still lands', () => {
  const branchMap: FieldMap = {
    models: {
      User: { fields: { account: { kind: 'object', type: 'Account' } } },
      Account: {
        fields: {
          industry: { kind: 'scalar', type: 'String' },
          type: { kind: 'scalar', type: 'String' },
          arr: { kind: 'scalar', type: 'Int' },
        },
      },
    },
  };
  const branchSource = { maps: { app: branchMap }, mapName: 'app', model: 'User' };
  const branchWhere = { field: 'account.industry', operator: 'equals', value: 'saas' };
  const decoration: Decoration = {
    facets: [
      {
        path: 'account',
        label: 'SaaS Company',
        where: branchWhere as Condition,
        selectors: [{ field: 'account.type', label: 'Type', anyLabel: 'Any type' }],
      },
    ],
  };
  const typeClause = (value: string): Condition =>
    ({ field: 'account.type', operator: 'equals', value }) as Condition;
  const arrRow: Condition = {
    field: 'account.arr',
    operator: 'greaterThan',
    value: 100,
  } as Condition;
  const group = (r: { root: unknown }) => (r.root as GroupNode).children[0] as GroupNode;
  const savedGroup = (r: { value: unknown }) => (r.value as { all: Condition[] }).all[0];

  test('where + selector clause both hoist; the group collapses to the rows surface', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: branchSource,
        decoration,
        defaultValue: {
          all: [{ all: [branchWhere as Condition, typeClause('startup'), arrRow] }],
        } as Condition,
      }),
    );
    const g = group(result.current);
    expect(g.hoist?.label).toBe('SaaS Company');
    expect(g.children).toHaveLength(1);
    expect(g.selectorClauses).toHaveLength(1);
    expect((g.selectorClauses?.[0] as { value?: { current?: unknown } })?.value?.current).toBe(
      'startup',
    );
    act(() => group(result.current).operator.set('any'));
    expect(savedGroup(result.current)).toEqual({
      all: [
        expect.objectContaining(branchWhere),
        expect.objectContaining(typeClause('startup')),
        { any: [expect.objectContaining(arrRow)] },
      ],
    });
  });

  test('the branch clause node remove() routes through the write seam', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: branchSource,
        decoration,
        defaultValue: {
          all: [{ all: [branchWhere as Condition, typeClause('startup'), arrRow] }],
        } as Condition,
      }),
    );
    act(() => group(result.current).selectorClauses?.[0]?.remove?.());
    expect(savedGroup(result.current)).toEqual({
      all: [expect.objectContaining(branchWhere), { all: [expect.objectContaining(arrRow)] }],
    });
  });

  test('the group write seam replaces and clears at the top of the group itself', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: branchSource,
        decoration,
        defaultValue: {
          all: [{ all: [branchWhere as Condition, typeClause('startup'), arrRow] }],
        } as Condition,
      }),
    );
    act(() => group(result.current).setSelectorClause?.('account.type', 'enterprise'));
    expect(savedGroup(result.current)).toEqual({
      all: [
        expect.objectContaining(branchWhere),
        expect.objectContaining(typeClause('enterprise')),
        { all: [expect.objectContaining(arrRow)] },
      ],
    });
    act(() => group(result.current).setSelectorClause?.('account.type', null));
    expect(savedGroup(result.current)).toEqual({
      all: [expect.objectContaining(branchWhere), { all: [expect.objectContaining(arrRow)] }],
    });
  });
});

describe('multi-hop collection — selector machinery is fenced off entirely', () => {
  const deepMap: FieldMap = {
    models: {
      User: { fields: { accounts: { kind: 'object', type: 'Account', isList: true } } },
      Account: { fields: { surveys: { kind: 'object', type: 'Survey', isList: true } } },
      Survey: {
        fields: {
          answer: { kind: 'scalar', type: 'String' },
          question: { kind: 'object', type: 'Question' },
        },
      },
      Question: { fields: { title: { kind: 'scalar', type: 'String' } } },
    },
  };
  const deepSource = { maps: { app: deepMap }, mapName: 'app', model: 'User' };
  const deepView: Decoration = {
    facets: [
      {
        path: 'accounts.surveys.answer',
        label: 'Account Surveys',
        selectors: [{ field: 'question.title', label: 'Question' }],
      },
    ],
    models: {
      Account: [
        {
          path: 'surveys',
          label: 'Survey Responses',
          selectors: [{ field: 'question.title', label: 'Question', anyLabel: 'Any question' }],
        },
      ],
    },
  };

  test('the anchor multi-hop facet is a seed only — the inner node is recognized natively at its own scope', () => {
    const before: Condition = {
      all: [
        {
          field: 'accounts',
          arrayOperator: 'any',
          condition: {
            all: [
              {
                field: 'surveys',
                arrayOperator: 'any',
                condition: { all: [question('Q1'), answer('A')] },
              } as Condition,
            ],
          },
        } as Condition,
      ],
    } as Condition;
    const { result } = renderHook(() =>
      useRuleBuilder({ source: deepSource, decoration: deepView, defaultValue: before }),
    );
    // No outer badge or seam: recognition never reaches down the chain.
    const node = facetNode(result.current);
    expect(node.hoist).toBeUndefined();
    expect(node.selectors).toBeUndefined();
    expect(node.setSelectorClause).toBeUndefined();
    // The inner surveys node wears the chrome, with the full selector machinery.
    const inner = node.condition?.children[0] as ArrayNode;
    expect(inner.hoist?.label).toBe('Survey Responses');
    expect(inner.selectorClauses).toHaveLength(1);
    act(() => inner.setSelectorClause?.('question.title', 'Q2'));
    const innermost = (savedNode(result.current).condition as { all: Condition[] }).all[0] as {
      condition: { all?: Condition[] };
    };
    expect(innermost.condition).toEqual({
      all: [
        expect.objectContaining(question('Q2')),
        { all: [expect.objectContaining(answer('A'))] },
      ],
    });
  });
});

describe('the write seam never crosses a structural boundary (adversarial round 2)', () => {
  test('a nested-array user row is never mistaken for a traversal hop — the clause conjoins at the node own block', () => {
    const nestedMap: FieldMap = {
      models: {
        User: { fields: { surveys: { kind: 'object', type: 'Survey', isList: true } } },
        Survey: {
          fields: {
            answer: { kind: 'scalar', type: 'String' },
            question: { kind: 'object', type: 'Question' },
            attachments: { kind: 'object', type: 'Attachment', isList: true },
          },
        },
        Question: { fields: { title: { kind: 'scalar', type: 'String' } } },
        Attachment: { fields: { name: { kind: 'scalar', type: 'String' } } },
      },
    };
    const nestedSource = { maps: { app: nestedMap }, mapName: 'app', model: 'User' };
    const attachRow: Condition = {
      field: 'attachments',
      arrayOperator: 'any',
      condition: { all: [{ field: 'name', operator: 'equals', value: 'x' } as Condition] },
    } as Condition;
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: nestedSource,
        decoration: surveyView,
        defaultValue: saved({ all: [attachRow] } as Condition),
      }),
    );
    act(() => facetNode(result.current).setSelectorClause?.('question.title', 'Q1'));
    // The clause lands at the Survey block, ABOVE the attachments row — never
    // inside it (where question.title cannot resolve).
    expect(savedNode(result.current).condition).toEqual({
      all: [
        expect.objectContaining(question('Q1')),
        { all: [expect.objectContaining({ field: 'attachments' })] },
      ],
    });
  });

  test('the fixed where is untouchable even when it sits on the declared selector field', () => {
    const officialView: Decoration = {
      facets: [
        {
          path: 'surveys',
          label: 'Official Questions',
          where: { field: 'question.title', operator: 'in', value: ['Q1', 'Q2'] } as Condition,
          selectors: [{ field: 'question.title', label: 'Question', anyLabel: 'Any official' }],
        },
      ],
    };
    const where = { field: 'question.title', operator: 'in', value: ['Q1', 'Q2'] };
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: officialView,
        defaultValue: saved({
          all: [where as Condition, question('Q1'), answer('A')],
        } as Condition),
      }),
    );
    // The read seam presents the clause AFTER the where prefix.
    expect(facetNode(result.current).selectorClauses).toHaveLength(1);
    // Re-pick replaces the selector clause; the where prefix never moves.
    act(() => facetNode(result.current).setSelectorClause?.('question.title', 'Q2'));
    expect(savedNode(result.current).condition).toEqual({
      all: [
        expect.objectContaining(where),
        expect.objectContaining(question('Q2')),
        { all: [expect.objectContaining(answer('A'))] },
      ],
    });
    expect(facetNode(result.current).hoist?.label).toBe('Official Questions');
    // Clearing removes the selector clause alone — the identity survives.
    act(() => facetNode(result.current).setSelectorClause?.('question.title', null));
    expect(savedNode(result.current).condition).toEqual({
      all: [expect.objectContaining(where), { all: [expect.objectContaining(answer('A'))] }],
    });
    expect(facetNode(result.current).hoist?.label).toBe('Official Questions');
  });

  test('a presence node offers no selector seam — there is no condition surface to write into', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: surveyView,
        defaultValue: {
          all: [{ field: 'surveys', arrayOperator: 'notEmpty' } as Condition],
        } as Condition,
      }),
    );
    const node = facetNode(result.current);
    expect(node.hoist?.label).toBe('Survey Responses');
    expect(node.selectors).toBeUndefined();
    expect(node.setSelectorClause).toBeUndefined();
  });

  test('a preset facet is atomic — declared selectors never leak a write seam', () => {
    const presetCondition: Condition = {
      field: 'surveys',
      arrayOperator: 'any',
      condition: { all: [question('Q1')] },
    } as Condition;
    const presetView: Decoration = {
      facets: [
        {
          label: 'Answered Q1',
          condition: presetCondition,
          selectors: [{ field: 'question.title', label: 'Question' }],
        },
      ],
    };
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: presetView,
        defaultValue: { all: [presetCondition] } as Condition,
      }),
    );
    const node = facetNode(result.current);
    expect(node.atomic).toBe(true);
    expect(node.selectors).toBeUndefined();
    expect(node.setSelectorClause).toBeUndefined();
  });

  test('clear then re-pick never destroys a visible duplicate row', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: surveyView,
        defaultValue: saved({ all: [question('Q1'), question('Q2')] } as Condition),
      }),
    );
    // Ingest: Q1 hoists, Q2 stays a visible row.
    expect(savedNode(result.current).condition).toEqual({
      all: [
        expect.objectContaining(question('Q1')),
        { all: [expect.objectContaining(question('Q2'))] },
      ],
    });
    // Clear unwraps to the rows alone; Q2 now renders as an ordinary row.
    act(() => facetNode(result.current).setSelectorClause?.('question.title', null));
    expect(savedNode(result.current).condition).toEqual({
      all: [expect.objectContaining(question('Q2'))],
    });
    // Re-pick conjoins OUTSIDE — what renders as a row is never replaced.
    act(() => facetNode(result.current).setSelectorClause?.('question.title', 'Q5'));
    expect(savedNode(result.current).condition).toEqual({
      all: [
        expect.objectContaining(question('Q5')),
        { all: [expect.objectContaining(question('Q2'))] },
      ],
    });
  });

  test('a lone uniform compound is the rows surface, not a claimable clause', () => {
    const before = saved({
      all: [{ any: [question('Q1'), question('Q2')] } as Condition],
    } as Condition);
    const { result } = renderHook(() =>
      useRuleBuilder({ source: surveySource, decoration: surveyView, defaultValue: before }),
    );
    // Not claimed at ingest: the compound stays where it is, nothing hides.
    expect(facetNode(result.current).selectorClauses).toBeUndefined();
    expect(savedNode(result.current).condition).toEqual({
      all: [
        { any: [expect.objectContaining(question('Q1')), expect.objectContaining(question('Q2'))] },
      ],
    });
  });

  test('selectorClauses is undefined — never [] — when nothing is picked', () => {
    const approvedView: Decoration = {
      facets: [
        {
          path: 'surveys',
          label: 'Approved',
          where: { field: 'answer', operator: 'notEquals', value: '' } as Condition,
          selectors: [{ field: 'question.title', label: 'Question' }],
        },
      ],
    };
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: approvedView,
        defaultValue: saved({
          all: [{ field: 'answer', operator: 'notEquals', value: '' } as Condition, answer('A')],
        } as Condition),
      }),
    );
    const node = facetNode(result.current);
    expect(node.hoist?.label).toBe('Approved');
    expect(node.selectorClauses).toBeUndefined();
    expect(node.setSelectorClause).toBeDefined();
  });

  test('the clause node remove() routes through the write seam — both removal gestures land on one shape', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: surveyView,
        defaultValue: saved({
          all: [question('Q1'), { any: [answer('A')] } as Condition],
        } as Condition),
      }),
    );
    act(() => facetNode(result.current).selectorClauses?.[0]?.remove?.());
    // Identical to setSelectorClause(null): unwrapped, the toggle surface is the
    // rows group itself again.
    expect(savedNode(result.current).condition).toEqual({
      any: [expect.objectContaining(answer('A'))],
    });
  });
});

describe('Json-path selectors — a sub-path into a Json column is a selector like any other', () => {
  const jsonMap: FieldMap = {
    models: {
      User: { fields: { surveys: { kind: 'object', type: 'Survey', isList: true } } },
      Survey: {
        fields: {
          answer: { kind: 'scalar', type: 'String' },
          meta: { kind: 'scalar', type: 'Json' },
        },
      },
    },
  };
  const jsonSource = { maps: { app: jsonMap }, mapName: 'app', model: 'User' };
  const jsonView: Decoration = {
    facets: [
      {
        path: 'surveys',
        label: 'Survey Responses',
        selectors: [{ field: 'meta.questionId', label: 'Question' }],
      },
    ],
  };
  const metaClause = (value: string): Condition =>
    ({ field: 'meta.questionId', operator: 'equals', value }) as Condition;

  test('the clause hoists at ingest; the leaf reads the Json column with the sub-path', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: jsonSource,
        decoration: jsonView,
        defaultValue: saved({ all: [metaClause('q_1'), answer('A')] } as Condition),
      }),
    );
    expect(savedNode(result.current).condition).toEqual({
      all: [
        expect.objectContaining(metaClause('q_1')),
        { all: [expect.objectContaining(answer('A'))] },
      ],
    });
    const node = facetNode(result.current);
    expect(node.selectorClauses).toHaveLength(1);
    // The leaf's field control reads the COLUMN — the Json sub-path rides on the
    // clause itself. A renderer keys its dropdown off the declared selector field.
    expect((node.selectorClauses?.[0] as { field?: { value?: string } })?.field?.value).toBe(
      'meta',
    );
    expect((node.selectorClauses?.[0] as { value?: { current?: unknown } })?.value?.current).toBe(
      'q_1',
    );
    act(() => facetNode(result.current).setSelectorClause?.('meta.questionId', 'q_2'));
    expect(savedNode(result.current).condition).toEqual({
      all: [
        expect.objectContaining(metaClause('q_2')),
        { all: [expect.objectContaining(answer('A'))] },
      ],
    });
  });
});

describe('per-model facets (Decoration.models)', () => {
  const view: Decoration = {
    facets: [],
    models: {
      Survey: [{ path: 'question.title', label: 'Question Title' }],
      User: [{ path: 'surveys', label: 'Never at root' }],
    },
  };

  test('a nested scope offers the model facets as picker seeds and recognizes them', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: view,
        defaultValue: saved({ all: [question('Q1')] } as Condition),
      }),
    );
    const inner = facetNode(result.current).condition;
    expect(inner?.children[0]?.hoist?.label).toBe('Question Title');
  });

  test('models never apply at the anchor root', () => {
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: view,
        defaultValue: {
          all: [{ field: 'surveys', arrayOperator: 'any' } as Condition],
        } as Condition,
      }),
    );
    expect(facetNode(result.current).hoist).toBeUndefined();
  });

  test('filter subtrees carry no facet machinery', () => {
    const filterView: Decoration = {
      facets: [],
      models: { Survey: [{ path: 'question.title', label: 'Question Title' }] },
    };
    const { result } = renderHook(() =>
      useRuleBuilder({
        source: surveySource,
        decoration: filterView,
        defaultValue: {
          all: [
            {
              field: 'surveys',
              arrayOperator: 'any',
              condition: { all: [answer('A')] },
              filter: { all: [question('Q1')] },
            } as Condition,
          ],
        } as Condition,
      }),
    );
    const node = facetNode(result.current);
    expect(node.filter?.children[0]?.hoist).toBeUndefined();
  });
});
