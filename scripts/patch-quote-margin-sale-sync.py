from pathlib import Path

path = Path("src/components/quote-structured-lines-editor.tsx")
source = path.read_text(encoding="utf-8")


def replace_once(old: str, new: str) -> None:
    global source
    count = source.count(old)
    if count != 1:
        raise SystemExit(f"expected exactly one occurrence, got {count}: {old[:120]!r}")
    source = source.replace(old, new, 1)


replace_once(
    'import { buildQuoteItemNumbers } from "@/lib/quotes/numbering";\n',
    'import { buildQuoteItemNumbers } from "@/lib/quotes/numbering";\nimport {\n  calculateQuoteMarginFromSalePrice,\n  calculateQuoteSalePriceFromMarginCents,\n  parseQuoteMarginInput,\n  quoteMarginToInput,\n  type QuotePricingDriver,\n} from "@/lib/quotes/pricing";\n',
)

replace_once(
    '''type OuvrageComponentForm = {\n  key: string;\n  id?: string;\n  libraryComponentId?: string;\n  description: string;\n  unit: string;\n  quantityInput: string;\n  costPriceEuros: string;\n  unitPriceEuros: string;\n};''',
    '''type OuvrageComponentForm = {\n  key: string;\n  id?: string;\n  libraryComponentId?: string;\n  description: string;\n  unit: string;\n  quantityInput: string;\n  costPriceEuros: string;\n  marginPercentInput: string;\n  unitPriceEuros: string;\n  pricingDriver: QuotePricingDriver;\n};''',
)

replace_once(
    '''    costPriceEuros: "",\n    unitPriceEuros: "0,00",\n  };''',
    '''    costPriceEuros: "",\n    marginPercentInput: "0",\n    unitPriceEuros: "0,00",\n    pricingDriver: "MARGIN",\n  };''',
)

replace_once(
    '''    costPriceEuros: centsToInput(component.costPriceCents),\n    unitPriceEuros: centsToInput(component.salePriceCents),\n  };''',
    '''    costPriceEuros: centsToInput(component.costPriceCents),\n    marginPercentInput: quoteMarginToInput(component.marginPercent),\n    unitPriceEuros: centsToInput(component.salePriceCents),\n    pricingDriver: "SALE_PRICE",\n  };''',
)

replace_once(
    '''        costPriceEuros: costPriceCents === null ? "" : centsToInput(costPriceCents),\n        unitPriceEuros: centsToInput(component.unitPriceCents),\n      };''',
    '''        costPriceEuros: costPriceCents === null ? "" : centsToInput(costPriceCents),\n        marginPercentInput:\n          costPriceCents === null\n            ? ""\n            : quoteMarginToInput(\n                calculateQuoteMarginFromSalePrice(costPriceCents, component.unitPriceCents),\n              ),\n        unitPriceEuros: centsToInput(component.unitPriceCents),\n        pricingDriver: "SALE_PRICE",\n      };''',
)

replace_once(
    '''      costPriceEuros: "",\n      unitPriceEuros: centsToInput(line.unitPriceCents ?? 0),\n    },''',
    '''      costPriceEuros: "",\n      marginPercentInput: "",\n      unitPriceEuros: centsToInput(line.unitPriceCents ?? 0),\n      pricingDriver: "SALE_PRICE",\n    },''',
)

replace_once(
    '''function componentMarginPercent(component: OuvrageComponentForm): number | null {\n  try {\n    const costPriceCents = optionalEurosToCents(component.costPriceEuros);\n    if (costPriceCents === undefined) return null;\n    return calculateQuoteOuvrageMarginPercent(\n      eurosToCents(component.unitPriceEuros),\n      costPriceCents,\n    );\n  } catch {\n    return null;\n  }\n}\n''',
    '''function componentMarginPercent(component: OuvrageComponentForm): number | null {\n  try {\n    if (component.marginPercentInput.trim()) {\n      return parseQuoteMarginInput(component.marginPercentInput);\n    }\n    const costPriceCents = optionalEurosToCents(component.costPriceEuros);\n    if (costPriceCents === undefined) return null;\n    return calculateQuoteMarginFromSalePrice(\n      costPriceCents,\n      eurosToCents(component.unitPriceEuros),\n    );\n  } catch {\n    return null;\n  }\n}\n''',
)

replace_once(
    '''  const [priceForced, setPriceForced] = useState(false);\n  const [forcedUnitPriceEuros, setForcedUnitPriceEuros] = useState("0,00");\n  const [headingEditor, setHeadingEditor] = useState<HeadingEditor>(null);''',
    '''  const [priceForced, setPriceForced] = useState(false);\n  const [forcedUnitPriceEuros, setForcedUnitPriceEuros] = useState("0,00");\n  const [forcedMarginPercentInput, setForcedMarginPercentInput] = useState("");\n  const [ouvragePricingDriver, setOuvragePricingDriver] =\n    useState<QuotePricingDriver>("SALE_PRICE");\n  const [headingEditor, setHeadingEditor] = useState<HeadingEditor>(null);''',
)

replace_once(
    '''  const currentMarginPercent =\n    effectiveUnitPrice === null\n      ? null\n      : calculateQuoteOuvrageMarginPercent(effectiveUnitPrice, calculatedUnitCost);\n\n  const visibleLibraryComponents''',
    '''  const currentMarginPercent =\n    effectiveUnitPrice === null\n      ? null\n      : calculateQuoteOuvrageMarginPercent(effectiveUnitPrice, calculatedUnitCost);\n  const ouvrageMarginInput = priceForced\n    ? forcedMarginPercentInput\n    : quoteMarginToInput(currentMarginPercent);\n\n  const visibleLibraryComponents''',
)

replace_once(
    '''    setPriceForced(false);\n    setForcedUnitPriceEuros("0,00");\n    setLibraryPickerOpen(false);''',
    '''    setPriceForced(false);\n    setForcedUnitPriceEuros("0,00");\n    setForcedMarginPercentInput("");\n    setOuvragePricingDriver("SALE_PRICE");\n    setLibraryPickerOpen(false);''',
)

replace_once(
    '''    setPriceForced(line.forcedUnitPriceCents !== undefined);\n    setForcedUnitPriceEuros(centsToInput(line.forcedUnitPriceCents ?? line.unitPriceCents ?? 0));\n    setLibraryPickerOpen(false);''',
    '''    setPriceForced(line.forcedUnitPriceCents !== undefined);\n    setForcedUnitPriceEuros(centsToInput(line.forcedUnitPriceCents ?? line.unitPriceCents ?? 0));\n    const lineCost = calculateQuoteOuvrageUnitCostCents(line.components ?? []);\n    setForcedMarginPercentInput(\n      quoteMarginToInput(\n        calculateQuoteMarginFromSalePrice(\n          lineCost ?? 0,\n          line.forcedUnitPriceCents ?? line.unitPriceCents ?? 0,\n        ),\n      ),\n    );\n    setOuvragePricingDriver("SALE_PRICE");\n    setLibraryPickerOpen(false);''',
)

replace_once(
    '''  function updateComponent(index: number, patch: Partial<OuvrageComponentForm>) {\n    setComponents((current) =>\n      current.map((component, componentIndex) =>\n        componentIndex === index ? { ...component, ...patch } : component,\n      ),\n    );\n  }\n\n  function addComponent()''',
    '''  function updateComponent(index: number, patch: Partial<OuvrageComponentForm>) {\n    setComponents((current) =>\n      current.map((component, componentIndex) =>\n        componentIndex === index ? { ...component, ...patch } : component,\n      ),\n    );\n  }\n\n  function updateComponentCost(index: number, value: string) {\n    setComponents((current) =>\n      current.map((component, componentIndex) => {\n        if (componentIndex !== index) return component;\n        const next = { ...component, costPriceEuros: value };\n        try {\n          const costPriceCents = optionalEurosToCents(value);\n          if (costPriceCents === undefined) return { ...next, marginPercentInput: "" };\n          if (component.pricingDriver === "MARGIN") {\n            return {\n              ...next,\n              unitPriceEuros: centsToInput(\n                calculateQuoteSalePriceFromMarginCents(\n                  costPriceCents,\n                  parseQuoteMarginInput(component.marginPercentInput),\n                ),\n              ),\n            };\n          }\n          return {\n            ...next,\n            marginPercentInput: quoteMarginToInput(\n              calculateQuoteMarginFromSalePrice(\n                costPriceCents,\n                eurosToCents(component.unitPriceEuros),\n              ),\n            ),\n          };\n        } catch {\n          return next;\n        }\n      }),\n    );\n  }\n\n  function updateComponentMargin(index: number, value: string) {\n    setComponents((current) =>\n      current.map((component, componentIndex) => {\n        if (componentIndex !== index) return component;\n        const next = {\n          ...component,\n          marginPercentInput: value,\n          pricingDriver: "MARGIN" as const,\n        };\n        try {\n          const costPriceCents = optionalEurosToCents(component.costPriceEuros);\n          if (costPriceCents === undefined) return next;\n          return {\n            ...next,\n            unitPriceEuros: centsToInput(\n              calculateQuoteSalePriceFromMarginCents(\n                costPriceCents,\n                parseQuoteMarginInput(value),\n              ),\n            ),\n          };\n        } catch {\n          return next;\n        }\n      }),\n    );\n  }\n\n  function updateComponentSalePrice(index: number, value: string) {\n    setComponents((current) =>\n      current.map((component, componentIndex) => {\n        if (componentIndex !== index) return component;\n        const next = {\n          ...component,\n          unitPriceEuros: value,\n          pricingDriver: "SALE_PRICE" as const,\n        };\n        try {\n          const costPriceCents = optionalEurosToCents(component.costPriceEuros);\n          if (costPriceCents === undefined) return { ...next, marginPercentInput: "" };\n          return {\n            ...next,\n            marginPercentInput: quoteMarginToInput(\n              calculateQuoteMarginFromSalePrice(costPriceCents, eurosToCents(value)),\n            ),\n          };\n        } catch {\n          return next;\n        }\n      }),\n    );\n  }\n\n  function updateOuvrageSalePrice(value: string) {\n    setPriceForced(true);\n    setOuvragePricingDriver("SALE_PRICE");\n    setForcedUnitPriceEuros(value);\n    try {\n      if (calculatedUnitCost === null) {\n        setForcedMarginPercentInput("");\n        return;\n      }\n      setForcedMarginPercentInput(\n        quoteMarginToInput(\n          calculateQuoteMarginFromSalePrice(calculatedUnitCost, eurosToCents(value)),\n        ),\n      );\n    } catch {\n      setForcedMarginPercentInput("");\n    }\n  }\n\n  function updateOuvrageMargin(value: string) {\n    setPriceForced(true);\n    setOuvragePricingDriver("MARGIN");\n    setForcedMarginPercentInput(value);\n    try {\n      if (calculatedUnitCost === null) return;\n      setForcedUnitPriceEuros(\n        centsToInput(\n          calculateQuoteSalePriceFromMarginCents(\n            calculatedUnitCost,\n            parseQuoteMarginInput(value),\n          ),\n        ),\n      );\n    } catch {\n      // Keep the partial input while the user is typing.\n    }\n  }\n\n  function addComponent()''',
)

replace_once(
    '''  function resetForcedPrice() {\n    setPriceForced(false);\n    setForcedUnitPriceEuros(centsToInput(calculatedUnitPrice ?? 0));\n  }''',
    '''  function resetForcedPrice() {\n    setPriceForced(false);\n    setOuvragePricingDriver("SALE_PRICE");\n    setForcedUnitPriceEuros(centsToInput(calculatedUnitPrice ?? 0));\n    setForcedMarginPercentInput(\n      quoteMarginToInput(\n        calculatedUnitPrice === null\n          ? null\n          : calculateQuoteMarginFromSalePrice(calculatedUnitCost ?? 0, calculatedUnitPrice),\n      ),\n    );\n  }''',
)

replace_once(
    '''  useEffect(() => {\n    if (!notice) return;\n    const timeout = window.setTimeout(() => setNotice(""), 4200);\n    return () => window.clearTimeout(timeout);\n  }, [notice]);\n\n  function resetForm()''',
    '''  useEffect(() => {\n    if (!notice) return;\n    const timeout = window.setTimeout(() => setNotice(""), 4200);\n    return () => window.clearTimeout(timeout);\n  }, [notice]);\n\n  useEffect(() => {\n    if (!priceForced || ouvragePricingDriver !== "MARGIN" || calculatedUnitCost === null) return;\n    try {\n      const next = centsToInput(\n        calculateQuoteSalePriceFromMarginCents(\n          calculatedUnitCost,\n          parseQuoteMarginInput(forcedMarginPercentInput),\n        ),\n      );\n      setForcedUnitPriceEuros((current) => (current === next ? current : next));\n    } catch {\n      // Keep the partial margin input while editing.\n    }\n  }, [calculatedUnitCost, forcedMarginPercentInput, ouvragePricingDriver, priceForced]);\n\n  useEffect(() => {\n    if (!priceForced || ouvragePricingDriver !== "SALE_PRICE") return;\n    if (calculatedUnitCost === null) {\n      setForcedMarginPercentInput("");\n      return;\n    }\n    try {\n      const next = quoteMarginToInput(\n        calculateQuoteMarginFromSalePrice(calculatedUnitCost, eurosToCents(forcedUnitPriceEuros)),\n      );\n      setForcedMarginPercentInput((current) => (current === next ? current : next));\n    } catch {\n      setForcedMarginPercentInput("");\n    }\n  }, [calculatedUnitCost, forcedUnitPriceEuros, ouvragePricingDriver, priceForced]);\n\n  function resetForm()''',
)

replace_once(
    '''              onChange={(event) => {\n                setPriceForced(true);\n                setForcedUnitPriceEuros(event.target.value);\n              }}\n              aria-label="Prix unitaire HT ouvrage"''',
    '''              onChange={(event) => updateOuvrageSalePrice(event.target.value)}\n              aria-label="Prix unitaire HT ouvrage"''',
)

replace_once(
    '''          <div className="quoteMarginCell">\n            <strong>{formatPercent(currentMarginPercent)}</strong>\n          </div>''',
    '''          <div className="quoteMarginCell">\n            <input\n              className="quoteInlineInput"\n              inputMode="decimal"\n              value={ouvrageMarginInput}\n              onChange={(event) => updateOuvrageMargin(event.target.value)}\n              aria-label="Marge pourcentage ouvrage"\n              title="Saisir la marge pour calculer le prix de vente"\n            />\n          </div>''',
)

replace_once(
    '''                  onChange={(event) =>\n                    updateComponent(index, { costPriceEuros: event.target.value })\n                  }\n                  placeholder="—"''',
    '''                  onChange={(event) => updateComponentCost(index, event.target.value)}\n                  placeholder="—"''',
)

replace_once(
    '''                <span\n                  className={\n                    marginPercent !== null && marginPercent < 0 ? "quoteNegative" : "quotePositive"\n                  }\n                >\n                  {formatPercent(marginPercent)}\n                </span>''',
    '''                <input\n                  className={`quoteInlineInput${\n                    marginPercent !== null && marginPercent < 0 ? " quoteNegative" : ""\n                  }`}\n                  inputMode="decimal"\n                  value={component.marginPercentInput}\n                  onChange={(event) => updateComponentMargin(index, event.target.value)}\n                  placeholder="n/c"\n                  aria-label={`Marge composant ${index + 1}`}\n                  title="Saisir la marge pour calculer le prix de vente"\n                />''',
)

replace_once(
    '''                  onChange={(event) =>\n                    updateComponent(index, { unitPriceEuros: event.target.value })\n                  }\n                  required\n                  aria-label={`Prix vente composant ${index + 1}`}''',
    '''                  onChange={(event) => updateComponentSalePrice(index, event.target.value)}\n                  required\n                  aria-label={`Prix vente composant ${index + 1}`}''',
)

path.write_text(source, encoding="utf-8")
