export {
  BASE_URL,
  DEFAULT_CONFIG,
  fetchPath,
  extractSlugs,
  indexSlugs,
  firstCard,
  parseSkill,
  mapActiveSkill,
  scrapeActiveSkills,
  parseModifiers,
  parseSupport,
  scrapeSupports,
  type TlidbConfig,
  type ParsedSkill
} from './scrape.js';

export {
  BUNDLE_BASE,
  DATA_VERSION,
  fetchBundle,
  leaves,
  mapGear,
  mapGearFromMaster,
  mapAffixes,
  mapLegendaries,
  mapHeroTraits,
  mapSkills,
  scrapeGear,
  scrapeAffixes,
  scrapeLegendaries,
  scrapeHeroTraits,
  scrapeSkillsFromBundles
} from './tlicompendium.js';
