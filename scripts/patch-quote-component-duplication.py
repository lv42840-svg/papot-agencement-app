from pathlib import Path


def replace_once(path: Path, old: str, new: str) -> None:
    source = path.read_text(encoding="utf-8")
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"anchor not found exactly once in {path}: {count}")
    path.write_text(source.replace(old, new, 1), encoding="utf-8")


editor = Path("src/components/quote-structured-lines-editor.tsx")
replace_once(
    editor,
    '''import {
  canMoveQuoteComponent,
  moveQuoteComponent,
  type QuoteComponentMoveDirection,
} from "@/lib/quotes/component-order";''',
    '''import {
  canMoveQuoteComponent,
  duplicateQuoteComponent,
  moveQuoteComponent,
  type QuoteComponentMoveDirection,
} from "@/lib/quotes/component-order";''',
)
replace_once(
    editor,
    '''  function moveComponent(index: number, direction: QuoteComponentMoveDirection) {
    setComponents((current) => moveQuoteComponent(current, index, direction));
  }

  function removeComponent(index: number) {''',
    '''  function moveComponent(index: number, direction: QuoteComponentMoveDirection) {
    setComponents((current) => moveQuoteComponent(current, index, direction));
  }

  function duplicateComponent(index: number) {
    setComponents((current) =>
      duplicateQuoteComponent(current, index, () => globalThis.crypto.randomUUID()),
    );
  }

  function removeComponent(index: number) {''',
)
replace_once(
    editor,
    '''                  <button
                    type="button"
                    className="quoteDeleteComponent"
                    onClick={() => removeComponent(index)}''',
    '''                  <button
                    type="button"
                    className="miniActionButton"
                    onClick={() => duplicateComponent(index)}
                    aria-label={`Dupliquer le composant ${index + 1}`}
                    title="Dupliquer le composant"
                  >
                    <Copy size={13} aria-hidden="true" />
                  </button>
                  <button
                    type="button"
                    className="quoteDeleteComponent"
                    onClick={() => removeComponent(index)}''',
)
replace_once(
    editor,
    '''grid-template-columns: minmax(220px, 1fr) 82px 70px 105px 82px 105px 105px 92px;''',
    '''grid-template-columns: minmax(220px, 1fr) 82px 70px 105px 82px 105px 105px 122px;''',
)

order = Path("src/lib/quotes/component-order.ts")
source = order.read_text(encoding="utf-8")
source += '''\nexport function duplicateQuoteComponent<T extends { key: string; id?: string }>(\n  components: readonly T[],\n  index: number,\n  createKey: () => string,\n): T[] {\n  const source = components[index];\n  if (!source) return [...components];\n\n  const duplicate = { ...source, key: createKey(), id: undefined } as T;\n  return [...components.slice(0, index + 1), duplicate, ...components.slice(index + 1)];\n}\n'''
order.write_text(source, encoding="utf-8")

test = Path("tests/quote-component-order.test.ts")
replace_once(
    test,
    '''import { canMoveQuoteComponent, moveQuoteComponent } from "../src/lib/quotes/component-order";''',
    '''import {
  canMoveQuoteComponent,
  duplicateQuoteComponent,
  moveQuoteComponent,
} from "../src/lib/quotes/component-order";''',
)
replace_once(
    test,
    '''  it("blocks movement outside the component list", () => {
    expect(canMoveQuoteComponent(3, 0, "UP")).toBe(false);
    expect(canMoveQuoteComponent(3, 2, "DOWN")).toBe(false);
    expect(canMoveQuoteComponent(3, 1, "UP")).toBe(true);
    expect(canMoveQuoteComponent(3, 1, "DOWN")).toBe(true);
    expect(moveQuoteComponent(["A", "B", "C"], 0, "UP")).toEqual(["A", "B", "C"]);
  });
});''',
    '''  it("blocks movement outside the component list", () => {
    expect(canMoveQuoteComponent(3, 0, "UP")).toBe(false);
    expect(canMoveQuoteComponent(3, 2, "DOWN")).toBe(false);
    expect(canMoveQuoteComponent(3, 1, "UP")).toBe(true);
    expect(canMoveQuoteComponent(3, 1, "DOWN")).toBe(true);
    expect(moveQuoteComponent(["A", "B", "C"], 0, "UP")).toEqual(["A", "B", "C"]);
  });

  it("duplicates a component immediately after the source with a fresh identity", () => {
    const source = [
      {
        key: "component-a",
        id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        libraryComponentId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
        description: "Panneau mélaminé",
        unit: "m²",
        quantityInput: "2,5",
        costPriceEuros: "22,50",
        marginPercentInput: "35",
        unitPriceEuros: "30,38",
        pricingDriver: "MARGIN" as const,
      },
      {
        key: "component-b",
        description: "Pose",
      },
    ];

    const duplicated = duplicateQuoteComponent(source, 0, () => "component-copy");

    expect(duplicated).toHaveLength(3);
    expect(duplicated[1]).toEqual({
      ...source[0],
      key: "component-copy",
      id: undefined,
    });
    expect(duplicated[1]).not.toBe(source[0]);
    expect(duplicated[2]).toBe(source[1]);
    expect(source).toHaveLength(2);
    expect(source[0].id).toBe("aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa");
  });

  it("ignores an invalid duplication index without mutating the source", () => {
    const source = [{ key: "a", description: "A" }];
    const duplicated = duplicateQuoteComponent(source, 4, () => "unused");

    expect(duplicated).toEqual(source);
    expect(duplicated).not.toBe(source);
  });
});''',
)
