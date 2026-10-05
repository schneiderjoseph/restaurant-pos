export type AiExamplePromptCategory =
  | "sales"
  | "operations"
  | "accounts"
  | "charts"
  | "analysis";

export type AiExamplePromptFilter = "all" | AiExamplePromptCategory;

export const AI_EXAMPLE_PROMPT_CATEGORIES: AiExamplePromptCategory[] = [
  "sales",
  "operations",
  "accounts",
  "charts",
  "analysis",
];

export interface AiExamplePrompt {
  category: AiExamplePromptCategory;
  prompt: string;
}

export const AI_EXAMPLE_PROMPTS: AiExamplePrompt[] = [
  // Sales
  {category: "sales", prompt: "Top 10 dishes by revenue this week"},
  {category: "sales", prompt: "Sales summary for yesterday with day-part breakdown"},
  {category: "sales", prompt: "Product mix by category this month — lowest profit items"},
  {category: "sales", prompt: "Who were the top 5 servers by net sales last month?"},
  {category: "sales", prompt: "Which products haven't sold in 60 days?"},
  {category: "sales", prompt: "Sales summary for every order taker during their current session"},
  {category: "sales", prompt: "How much tips were collected today and how would they be distributed?"},
  {category: "sales", prompt: "Summarize promotional discounts applied today over 20% of the bill"},
  {category: "sales", prompt: "Tax summary for this month"},
  {category: "sales", prompt: "Coupon usage summary this month"},
  {category: "sales", prompt: "Weekly sales breakdown by day part"},
  {category: "sales", prompt: "Hourly product sales for peak hours today"},
  {category: "sales", prompt: "Voids by reason this week"},

  // Operations
  {category: "operations", prompt: "Who are my top 3 fastest and slowest servers by ticket time this week?"},
  {category: "operations", prompt: "Which server has the lowest turnaround and highest average check?"},
  {category: "operations", prompt: "Flag order takers with void or discount rates above team average this week"},
  {category: "operations", prompt: "Average ticket time for delivery vs dine-in this week"},
  {category: "operations", prompt: "Which kitchen stations are slowest between 7 PM and 9 PM?"},
  {category: "operations", prompt: "Show cash orders modified or removed before close"},
  {category: "operations", prompt: "Cancel and comp reasons summary for last month"},
  {category: "operations", prompt: "Show me orders with in progress status"},
  {category: "operations", prompt: "Get everything for order id order:pkzurx2a73wxstql09bv including items, voids, discounts, taxes, and tracking"},
  {category: "operations", prompt: "Show delivery orders in progress"},
  {category: "operations", prompt: "Expense summary from closings this week"},
  {category: "operations", prompt: "Activity log audit for today"},
  {category: "operations", prompt: "Show suspicious cash register activity this week"},
  {category: "operations", prompt: "Investigate potential fraud — voids, discounts, and tracking records"},
  {category: "operations", prompt: "Add Margherita pizza to Grill kitchen station"},
  {category: "operations", prompt: "Show dishes assigned to Grill kitchen"},

  // Accounts
  {category: "accounts", prompt: "Trial balance as of today — do debits equal credits?"},
  {category: "accounts", prompt: "Do trial balance debits equal credits as of yesterday?"},
  {category: "accounts", prompt: "Profit and loss for this month"},
  {category: "accounts", prompt: "Balance sheet as of month-end"},
  {category: "accounts", prompt: "Cash flow this month by operating vs investing"},
  {category: "accounts", prompt: "General ledger for account 1010 in March"},
  {category: "accounts", prompt: "Posted journal entries from source module purchase this week"},
  {category: "accounts", prompt: "Customer statement for account 1200 this month"},
  {category: "accounts", prompt: "Supplier statement for account 2100 this month"},
  {category: "accounts", prompt: "List chart of accounts for customer accounts"},

  // Charts
  {category: "charts", prompt: "Line chart of daily net sales for the last 30 days"},
  {category: "charts", prompt: "Forecast net sales for the next 7 days"},
  {category: "charts", prompt: "Bar chart of top 10 dishes by revenue this week"},

  // Analysis
  {category: "analysis", prompt: "Compare net sales this week vs last week"},
  {category: "analysis", prompt: "Give me a quick business health overview"},
  {category: "analysis", prompt: "Daily net sales time series for the last 30 days"},
];

/** Advanced analytics prompts still backed by live tools (for test coverage). */
export const ADVANCED_ANALYTICS_PLAN_PROMPTS = [
  "Who are my top 3 fastest and slowest servers by ticket time this week?",
  "Which server has the lowest turnaround and highest average check?",
  "Flag order takers with void or discount rates above team average this week",
  "Show cash orders modified or removed before close",
  "Summarize promotional discounts applied today over 20% of the bill",
  "Average ticket time for delivery vs dine-in this week",
  "Which kitchen stations are slowest between 7 PM and 9 PM?",
  "Cancel and comp reasons summary for last month",
] as const;
