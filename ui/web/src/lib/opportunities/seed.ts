/**
 * Curated seed list of B2B targets for the Opportunity Finder.
 *
 * Each entry is a real or plausible buyer of lab-grown diamonds —
 * retailers, marketplaces, and jewelry chains. The LLM enriches these at
 * runtime with a fit summary, contact role, and confidence; the seed
 * itself is just the structured backbone (so we don't pretend to do live
 * web search but still surface concrete, region-appropriate prospects).
 */

export type Region =
  | 'North America'
  | 'Europe'
  | 'India'
  | 'Middle East'
  | 'Asia-Pacific';

export type Segment =
  | 'Big-box retail'
  | 'Specialty jeweler'
  | 'Online marketplace'
  | 'Department store'
  | 'Bridal chain'
  | 'Luxury house';

export type SeedOpportunity = {
  id: string;
  company: string;
  region: Region;
  segment: Segment;
  /** Public-facing supplier / vendor portal URL (if known). */
  portal_url?: string;
  /** What the buyer is reportedly sourcing — informs the email pitch. */
  reported_demand: string;
};

export const SEED: SeedOpportunity[] = [
  // ── North America
  { id: 'walmart',    company: 'Walmart',          region: 'North America', segment: 'Big-box retail',     portal_url: 'https://corporate.walmart.com/suppliers', reported_demand: 'LG bridal under $1,500 retail; expanding fine-jewelry shop-in-shop' },
  { id: 'costco',     company: 'Costco Wholesale', region: 'North America', segment: 'Big-box retail',     portal_url: 'https://www.costco.com/supplier-resources', reported_demand: 'LG solitaires 1-3ct, GIA-certified, sharp price points' },
  { id: 'signet',     company: 'Signet Jewelers',  region: 'North America', segment: 'Bridal chain',       portal_url: 'https://www.signetjewelers.com/suppliers', reported_demand: 'LG bridal & fashion across Kay, Zales, Jared banners' },
  { id: 'macys',      company: "Macy's",            region: 'North America', segment: 'Department store',   reported_demand: 'Mid-tier LG fashion jewelry, gift-priced ($500-$2,500)' },
  { id: 'bluenile',   company: 'Blue Nile',         region: 'North America', segment: 'Online marketplace', reported_demand: 'Inventory drop-ship: LG rounds, ovals, princess; IGI or GIA' },
  { id: 'helzberg',   company: 'Helzberg Diamonds', region: 'North America', segment: 'Specialty jeweler',  reported_demand: 'LG centers for engagement; private-label collections' },

  // ── Europe
  { id: 'pandora',    company: 'Pandora',          region: 'Europe',        segment: 'Bridal chain',       portal_url: 'https://pandoragroup.com/suppliers', reported_demand: 'LG fashion jewelry — already 100% lab-grown for their LG line' },
  { id: 'harrods',    company: 'Harrods',          region: 'Europe',        segment: 'Department store',   reported_demand: 'Premium LG fashion + bespoke commissions for in-store atelier' },
  { id: 'goldsmiths', company: 'Goldsmiths (UK)',  region: 'Europe',        segment: 'Specialty jeweler',  reported_demand: 'LG bridal, growing share of engagement assortment' },

  // ── India
  { id: 'tanishq',    company: 'Tanishq (Titan)',  region: 'India',         segment: 'Specialty jeweler',  portal_url: 'https://www.titancompany.in/suppliers', reported_demand: 'LG line launched 2024; sourcing certified LG bridal & studs' },
  { id: 'kalyan',     company: 'Kalyan Jewellers', region: 'India',         segment: 'Bridal chain',       reported_demand: 'LG line expansion across Tier-1 & Tier-2 stores' },
  { id: 'reliance',   company: 'Reliance Jewels',  region: 'India',         segment: 'Bridal chain',       reported_demand: 'Building LG capability for Reliance Retail jewelry vertical' },
  { id: 'caratlane',  company: 'CaratLane',        region: 'India',         segment: 'Online marketplace', reported_demand: 'LG fashion under ₹1L; rapid SKU turnover model' },

  // ── Middle East
  { id: 'damas',      company: 'Damas Jewellery',  region: 'Middle East',   segment: 'Specialty jeweler',  reported_demand: 'LG bridal pilot programs; UAE consumer acceptance growing' },
  { id: 'malabar',    company: 'Malabar Gold',     region: 'Middle East',   segment: 'Bridal chain',       reported_demand: 'LG diversification across GCC stores; 0.5-2ct centers' },

  // ── Asia-Pacific
  { id: 'chowtaifook',company: 'Chow Tai Fook',    region: 'Asia-Pacific',  segment: 'Bridal chain',       reported_demand: 'LG bridal pilot in mainland China & HK; price-tier strategy' },
  { id: 'michhill',   company: 'Michael Hill (AU)',region: 'Asia-Pacific',  segment: 'Specialty jeweler',  reported_demand: 'LG engagement assortment; 6-month inventory plan' },
];

export const ALL_REGIONS: Region[] = [
  'North America', 'Europe', 'India', 'Middle East', 'Asia-Pacific',
];
