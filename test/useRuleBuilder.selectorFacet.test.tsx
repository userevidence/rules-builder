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
