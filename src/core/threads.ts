import type { ParsedRequest, PrefixRelation } from "./types.js";
import { comparisonKeys } from "./prefix.js";
import { sameModel } from "./model-id.js";

/**
 * A request log is not one conversation. A proxy capture of a coding agent
 * holds its main loop and, between the turns, small side requests on another
 * model; a gateway's log holds every user's conversation, interleaved. The
 * line before a request is then some other conversation's, and comparing the
 * two reports a cache break on every line where there is none.
 *
 * So each request is compared with the request it continues, wherever in the
 * file that is. In order of preference:
 *
 * 1. `continues`: the earlier request whose messages this one starts with,
 *    all of them and in order. An agent loop re-sends its history and adds
 *    to it, so this is the previous turn of the same conversation.
 * 2. `rewrites`: no request's messages are a prefix of this one's, but at
 *    least half of a recent request's messages are re-sent somewhere in it:
 *    the same conversation with its history edited (a sliding window, a
 *    tool result trimmed, a message re-serialized differently).
 * 3. `new_conversation`: nothing of the conversation was sent before, but
 *    the tools and system prompt were, at least once volatile values and
 *    ordering are normalized away: a new conversation of the same
 *    application. It is compared with the most similar earlier request, and
 *    only as far as the setup they share.
 * 4. Otherwise, still `new_conversation` against the request just before it
 *    when that one is on the same model with the same tools, which keeps a
 *    system prompt rebuilt on every request visible.
 *
 * A request that matches none of these starts a conversation with nothing
 * to compare it to, like the first request of a file.
 */
export interface Threads {
  /** For each request: the index of the earlier request it is compared with, if any. */
  predecessor: (number | undefined)[];
  /** For each request: how it relates to that predecessor. */
  relation: (PrefixRelation | undefined)[];
  /** For each request: the number (from 0, in order of first appearance) of its conversation. */
  conversation: number[];
  conversationCount: number;
}

/** Interns sequences of keys: a node id stands for everything up to and including one item. */
class PrefixTrie {
  private readonly itemIds = new Map<string, number>();
  private readonly children = new Map<number, Map<number, number>>();
  private nextNode = 1; // 0 is the empty prefix

  item(key: string): number {
    let id = this.itemIds.get(key);
    if (id === undefined) {
      id = this.itemIds.size;
      this.itemIds.set(key, id);
    }
    return id;
  }

  /** The node reached after each key in turn. Equal nodes at the same position mean equal prefixes. */
  path(keys: string[]): number[] {
    const out: number[] = [];
    let node = 0;
    for (const key of keys) {
      const item = this.item(key);
      let next = this.children.get(node);
      if (next === undefined) {
        next = new Map();
        this.children.set(node, next);
      }
      let child = next.get(item);
      if (child === undefined) {
        child = this.nextNode++;
        next.set(item, child);
      }
      out.push(child);
      node = child;
    }
    return out;
  }
}

/**
 * For each request, the trie node of each of its leading runs of segments,
 * in the order the provider serializes them. Two requests share their first
 * `n` segments exactly when their paths agree at position `n - 1`. With
 * `normalizeVolatile`, segments are compared as the optimized scenario
 * compares them (see prefix.ts).
 */
export function prefixPaths(requests: ParsedRequest[], normalizeVolatile: boolean): number[][] {
  const trie = new PrefixTrie();
  return requests.map((request) => trie.path(comparisonKeys(request.segments, normalizeVolatile)));
}

/** How many leading positions two paths share. Agreement is monotone, so this is a binary search. */
function sharedLength(a: number[], b: number[]): number {
  let low = 0;
  let high = Math.min(a.length, b.length);
  while (low < high) {
    const mid = (low + high + 1) >> 1;
    if (a[mid - 1] === b[mid - 1]) low = mid;
    else high = mid - 1;
  }
  return low;
}

const isMessage = (category: string): boolean => category !== "tools" && category !== "system";

/** How many earlier requests are looked at for a rewritten history, and for candidates that tie. */
const RECENT = 64;
/** The share of an earlier request's messages a request must re-send to count as rewriting it. */
const REWRITE_OVERLAP = 0.5;

export function threadRequests(
  requests: ParsedRequest[],
  raw: number[][] = prefixPaths(requests, false),
  normalized: number[][] = prefixPaths(requests, true),
): Threads {
  // Messages on their own: which conversation a request belongs to does not depend on its tools
  // or system prompt, which are exactly what a cache-breaking request gets wrong.
  const messageTrie = new PrefixTrie();
  const messageKeys = requests.map((r) => comparisonKeys(r.segments.filter((s) => isMessage(s.category)), false));
  const messageItems = messageKeys.map((keys) => keys.map((key) => messageTrie.item(key)));
  const messagePaths = messageKeys.map((keys) => messageTrie.path(keys));
  /** Requests whose message list ends exactly at a node, latest last. */
  const endingAt = new Map<number, number[]>();
  const toolNames = requests.map((r) => r.segments.filter((s) => s.category === "tools").map((s) => s.label).join("\u0000"));

  /** The latest request whose normalized path goes through each node, by node id. */
  const latestThrough: (number | undefined)[] = [];

  const predecessor: (number | undefined)[] = [];
  const relation: (PrefixRelation | undefined)[] = [];

  /** The best of `candidates` by: longest shared setup (normalized), same model, longest shared bytes, latest. */
  const closest = (i: number, candidates: number[]): number | undefined => {
    let best: number | undefined;
    let bestScore: [number, number, number] = [-1, -1, -1];
    for (const j of candidates) {
      const score: [number, number, number] = [
        sharedLength(normalized[i]!, normalized[j]!),
        sameModel(requests[i]!.model, requests[j]!.model) ? 1 : 0,
        sharedLength(raw[i]!, raw[j]!),
      ];
      const better = score[0] !== bestScore[0] ? score[0] > bestScore[0] : score[1] !== bestScore[1] ? score[1] > bestScore[1] : score[2] !== bestScore[2] ? score[2] > bestScore[2] : best === undefined || j > best;
      if (better) {
        best = j;
        bestScore = score;
      }
    }
    return best;
  };

  for (let i = 0; i < requests.length; i++) {
    const path = messagePaths[i]!;
    let found: number | undefined;
    let how: PrefixRelation | undefined;

    // 1. The longest earlier message list this one starts with.
    for (let length = path.length; length >= 1 && found === undefined; length--) {
      const ending = endingAt.get(path[length - 1]!);
      if (ending && ending.length > 0) {
        found = closest(i, ending.slice(-RECENT));
        how = "continues";
      }
    }

    // 2. A recent request most of whose messages are re-sent, though not as a prefix.
    if (found === undefined && path.length > 0) {
      const mine = new Set(messageItems[i]);
      let bestOverlap = 0;
      const tied: number[] = [];
      for (let j = Math.max(0, i - RECENT); j < i; j++) {
        const theirs = messageItems[j]!;
        if (theirs.length === 0) continue;
        let shared = 0;
        for (const item of theirs) if (mine.has(item)) shared++;
        const overlap = shared / theirs.length;
        if (overlap < REWRITE_OVERLAP) continue;
        if (overlap > bestOverlap) {
          bestOverlap = overlap;
          tied.length = 0;
        }
        if (overlap === bestOverlap) tied.push(j);
      }
      if (tied.length > 0) {
        found = closest(i, tied);
        how = "rewrites";
      }
    }

    // 3. A new conversation on a setup already sent: the earlier request sharing the most of it.
    if (found === undefined && i > 0) {
      const mine = normalized[i]!;
      // Whether an earlier request went through a node is monotone along the path.
      let longest = 0;
      let high = mine.length;
      while (longest < high) {
        const mid = (longest + high + 1) >> 1;
        if (latestThrough[mine[mid - 1]!] !== undefined) longest = mid;
        else high = mid - 1;
      }
      if (longest > 0) {
        const candidates = [latestThrough[mine[longest - 1]!]!];
        for (let j = Math.max(0, i - RECENT); j < i; j++) {
          if (j !== candidates[0] && sharedLength(mine, normalized[j]!) === longest) candidates.push(j);
        }
        found = closest(i, candidates);
        how = "new_conversation";
      } else if (sameModel(requests[i - 1]!.model, requests[i]!.model) && toolNames[i - 1] === toolNames[i] && requests[i - 1]!.segments[0]?.category === requests[i]!.segments[0]?.category) {
        // 4. Nothing shared, but the same model and tools as the line before: one application
        // whose prefix changes from its first byte.
        found = i - 1;
        how = "new_conversation";
      }
    }

    predecessor.push(found);
    relation.push(how);
    for (const node of normalized[i]!) latestThrough[node] = i;
    if (path.length > 0) {
      const node = path[path.length - 1]!;
      const list = endingAt.get(node);
      if (list) list.push(i);
      else endingAt.set(node, [i]);
    }
  }

  const conversation: number[] = [];
  let conversationCount = 0;
  for (let i = 0; i < requests.length; i++) {
    const from = predecessor[i];
    conversation.push(from !== undefined && relation[i] !== "new_conversation" ? conversation[from]! : conversationCount++);
  }
  return { predecessor, relation, conversation, conversationCount };
}
