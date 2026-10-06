// The words lib/format.ts puts around a figure or a date: relative days,
// size units, the kinds of account a bank reports.

export const de = {
  today: 'Heute',
  yesterday: 'Gestern',
  tomorrow: 'Morgen',
  noDate: 'Ohne Datum',
  /** Decimal units, smallest first. */
  bytes: ['Byte', 'kB', 'MB', 'GB'] as string[],
  /** "47 von 105 MB": a part of a whole, for progress. */
  partOf: (part: string, whole: string) => `${part} von ${whole}`,
  /** The FinTS account type (lib-fints' names) as a person calls it. */
  accountTypes: {
    CheckingAccount: 'Girokonto',
    SavingsAccount: 'Sparkonto',
    FixedDepositAccount: 'Festgeld',
    SecuritiesAccount: 'Depot',
    LoanMortgageAccount: 'Kredit',
    CreditCardAccount: 'Kreditkarte',
    HomeSavingsContract: 'Bausparvertrag',
    InsurancePolicy: 'Versicherung',
    InvestmentCompanyFund: 'Fonds',
    Miscellaneous: 'Konto',
  } as Record<string, string>,
  /** An account type the bank did not name. */
  accountType: 'Konto',
};

export const en: typeof de = {
  today: 'Today',
  yesterday: 'Yesterday',
  tomorrow: 'Tomorrow',
  noDate: 'No date',
  bytes: ['bytes', 'kB', 'MB', 'GB'],
  partOf: (part, whole) => `${part} of ${whole}`,
  accountTypes: {
    CheckingAccount: 'Current account',
    SavingsAccount: 'Savings account',
    FixedDepositAccount: 'Fixed deposit',
    SecuritiesAccount: 'Securities account',
    LoanMortgageAccount: 'Loan',
    CreditCardAccount: 'Credit card',
    HomeSavingsContract: 'Building savings contract',
    InsurancePolicy: 'Insurance',
    InvestmentCompanyFund: 'Fund',
    Miscellaneous: 'Account',
  },
  accountType: 'Account',
};
