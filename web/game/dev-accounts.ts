// The author's accounts: the page shows them the developer boss page, and the
// API does not cap their feedback / set contributions. Matched as a Showdown
// name id (lower case, letters and digits only), so spelling and spaces do
// not matter.
export const DEV_ACCOUNTS: readonly string[] = ['lonietzzz'];
export const accountId = (name: string): string => name.toLowerCase().replace(/[^a-z0-9]/g, '');
export const isDevAccount = (name: string | null | undefined): boolean => !!name && DEV_ACCOUNTS.includes(accountId(name));
