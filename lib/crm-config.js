// Shared CRM settings: deal types, pipeline stages, lists. Sent to the browser with the data so both sides agree.

const RE_BUY = ["Lead", "Pre-approval", "Touring", "Offer", "In escrow", "Closed", "Lost"];
const RE_SELL = ["Lead", "Home value / CMA", "Listing agreement", "Listed", "In escrow", "Closed", "Lost"];
const RE_LEASE = ["Lead", "Touring", "Application", "Lease signed", "Lost"];
const LOAN = ["Lead", "Application", "Pre-approved", "Processing", "Underwriting", "Conditional approval", "Clear to close", "Funded", "Lost"];

const DEAL_TYPES = {
  "Buy": { group: "Real estate", stages: RE_BUY },
  "Sell": { group: "Real estate", stages: RE_SELL },
  "Lease / rent": { group: "Real estate", stages: RE_LEASE },
  "Purchase loan": { group: "Mortgage", stages: LOAN },
  "Refinance": { group: "Mortgage", stages: LOAN },
  "Cash-out refinance": { group: "Mortgage", stages: LOAN },
  "HELOC / home equity": { group: "Mortgage", stages: LOAN },
  "Investment loan (DSCR)": { group: "Mortgage", stages: LOAN },
};
// A stage counts as finished (won or lost) when it is one of these.
const WON = ["Closed", "Funded", "Lease signed"];
const LOST = ["Lost"];

module.exports = {
  DEAL_TYPES,
  WON,
  LOST,
  LOAN_PROGRAMS: ["Conventional", "FHA", "VA", "USDA", "Jumbo", "DSCR", "Bank statement / Non-QM", "ITIN", "Reverse (HECM)", "Construction", "Bridge", "HELOC", "Other"],
  CONTACT_TYPES: ["Buyer", "Seller", "Borrower", "Refinance", "Investor", "Landlord", "Renter", "Past client", "Referral partner", "Recruit"],
  STATUSES: ["New", "Contacted", "Nurturing", "Active", "Under contract", "Closed", "Not interested"],
  TEMPS: ["Hot", "Warm", "Cold"],
  SOURCES: ["Website", "Phone call", "Referral", "Past client", "Zillow", "Open house", "Sign call", "Social media", "Walk-in", "Other"],
  TASK_KINDS: ["Call", "Text", "Email", "Meeting", "Showing", "Documents", "Other"],
  LOG_KINDS: ["Note", "Call", "Text", "Email", "Meeting"],
  TITLES: ["Broker", "Agent", "Loan officer", "Agent & loan officer", "Assistant"],
};
