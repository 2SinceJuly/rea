import { describe, expect, it } from "vitest";

import type { JsonValue } from "../jsonValue.js";
import { childCandidates, childConditions } from "./selectorCandidates.js";

const element = (
  name: string,
  attributes: Record<string, string>,
  children: JsonValue[] = [],
): JsonValue => ({ name, attributes, children });

describe("childCandidates", () => {
  it("ranks a child's own text, then an identifier a child carries, then text a child joins from its own elements, and no id an app generates", () => {
    const child = element("child", {}, [
      element("object", { class: "GtkButton", id: "submit_button" }, [
        element("property", { name: "label" }, ["Send"]),
      ]),
      element("packing", {}, [element("property", {}, ["1"])]),
      element("note", {}, ["Primary"]),
      element("layer", { id: "{18eadb5d-04fc-4448-a0f9-1f9a3dedaff7}" }),
      element("node", { ID: "ID_329023692" }),
      element("shape", { "draw:id": "id2" }),
      element("cell", { name: "B2" }),
    ]);

    expect(childCandidates(child)).toEqual([
      "[>note=Primary]",
      "[>object@id=submit_button]",
      "[>cell@name=B2]",
      "[>object=Send]",
      "[>packing=1]",
    ]);
  });
});

describe("childConditions", () => {
  /**
   * Count the code units every `for...of` over a string consumes while `read`
   * runs, which is the read `shortText` performs. Adjusting
   * `String.prototype[Symbol.iterator]` is only observable by that loop; `trim`,
   * `includes` and the timestamp probes read their own primitives.
   */
  const countingStringReads = <Result>(read: () => Result) => {
    const original = String.prototype[Symbol.iterator];
    let codeUnitsRead = 0;
    String.prototype[Symbol.iterator] = function* (
      this: string,
    ): Generator<string, undefined, undefined> {
      for (let index = 0; index < this.length; index += 1) {
        codeUnitsRead += 1;
        yield this[index] as string;
      }
      return undefined;
    };
    try {
      return { result: read(), codeUnitsRead: () => codeUnitsRead };
    } finally {
      String.prototype[Symbol.iterator] = original;
    }
  };

  /** An element whose only string the loop reads is its `body` child's text. */
  const record = (text: string) => ({
    name: "record",
    attributes: {},
    children: [{ name: "body", attributes: {}, children: [text] }],
  });

  it("stops reading a child's text once it is past what a selector names a member by, however long the text", () => {
    const huge = countingStringReads(() =>
      childConditions(record(`a b ${"x".repeat(4 * 1024 * 1024)}`)),
    );

    expect(huge.result).toEqual([]);
    // Reading stops at the 65th code unit, the first past the 64 a selector
    // names a member by, so the remaining 4 MiB costs nothing.
    expect(huge.codeUnitsRead()).toBe(65);
  });

  it("reads a child's text to its end when it stays within what a selector names a member by", () => {
    const short = countingStringReads(() =>
      childConditions(record("a b Budget")),
    );

    expect(short.result).toEqual(["[>body=a b Budget]"]);
    expect(short.codeUnitsRead()).toBe(10);
  });
});
