// Runtime pricing resolution — PART 4/20. The published price a customer
// sees always ultimately comes from ONE place: either the code-level
// defaults in pricingConfig.js, or (once a SUPERADMIN has published one) the
// newest `status: "published"` BrandeePricingConfig row. This is the single
// function every consumer (public config endpoint, Brandee subscribe route,
// landing-page pricing section) should call — never read pricingConfig.js's
// PLANS constant directly at runtime except as this function's fallback.
//
// Same DB-unreachable fallback pattern as templateCatalog.js: if Postgres
// isn't reachable, this returns the code defaults rather than failing the
// whole pricing page.

const { prisma } = require("../db");
const pricingConfig = require("./pricingConfig");

async function getPublishedOverride() {
  try {
    return await prisma.brandeePricingConfig.findFirst({ where: { status: "published" }, orderBy: { publishedAt: "desc" } });
  } catch (error) {
    return null;
  }
}

/**
 * Returns the effective pricing configuration to display/use right now.
 * Shape: { source: "code_default" | "published_override", taxMode,
 * pricesAreTaxInclusive, vatRatePercent, plans, comboSavings }.
 */
async function getEffectivePricing() {
  const override = await getPublishedOverride();
  if (override) {
    const plans = override.plans;
    return {
      source: "published_override",
      configId: override.id,
      taxMode: override.taxMode,
      pricesAreTaxInclusive: override.pricesAreTaxInclusive,
      vatRatePercent: Number(override.vatRatePercent),
      plans,
      publishedAt: override.publishedAt
    };
  }
  return {
    source: "code_default",
    configId: null,
    taxMode: pricingConfig.DEFAULT_TAX_CONFIG.taxMode,
    pricesAreTaxInclusive: pricingConfig.DEFAULT_TAX_CONFIG.pricesAreTaxInclusive,
    vatRatePercent: pricingConfig.DEFAULT_TAX_CONFIG.vatRatePercent,
    plans: pricingConfig.listPlans(),
    publishedAt: null
  };
}

module.exports = { getPublishedOverride, getEffectivePricing };
