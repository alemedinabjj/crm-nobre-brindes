export type ViolationCode =
  | 'SAME_STAGE'
  | 'FROM_FINAL_STAGE'
  | 'TRANSITION_NOT_ALLOWED'
  | 'MISSING_ESTIMATED_VALUE'
  | 'MISSING_ITEMS'
  | 'MISSING_PROPOSAL_VALIDITY'
  | 'MISSING_LOSS_REASON'
  | 'MISSING_BACKWARD_REASON'
  | 'FINAL_STAGE_READ_ONLY'
  | 'CONTACT_IN_FUTURE';

export type RuleViolation = { code: ViolationCode; message: string };
