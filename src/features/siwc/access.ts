// Adapted from ChatGPT Plan Playground (MIT); see LICENSE.
import {
  type Account,
  type Credentials,
  directScope,
} from "./credentials";
import { BoundaryError } from "./result";

export const requireSession = (account: Account, now: number) => {
  if (!account.session) throw new BoundaryError("not_signed_in");
  if (account.session.refreshUncertain)
    throw new BoundaryError("refresh_uncertain");
  if (!account.session.scopes.includes(directScope))
    throw new BoundaryError("missing_scope");
  if (account.session.expiresAt <= now)
    throw new BoundaryError("token_expired");
  return account.session;
};
export const activeAccount = (state: Credentials, now: number) => {
  const account = state.accounts.find(
    (item) => item.id === state.activeAccountId,
  );
  if (!account) throw new BoundaryError("not_signed_in");
  requireSession(account, now);
  return account;
};
