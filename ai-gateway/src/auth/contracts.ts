export type Identifier =
  | { kind: "email"; value: string }
  | { kind: "uid"; value: string };

export type UidSelectionState = {
  candidateUids: number[];
  selectedUid: number | null;
  refreshesUsed: number;
  refreshesRemaining: number;
  expiresAt: string;
  status: "pending" | "completed" | "expired";
  publicUid: number | null;
};

export type AuthSessionResult = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  user: {
    id: string;
    public_uid: number | null;
    display_name: string;
    role: string;
  };
};

export type AuthErrorCode =
  | "invalid_request"
  | "invalid_identifier"
  | "invalid_uid"
  | "invalid_credentials"
  | "authentication_required"
  | "email_confirmation_required"
  | "uid_activation_required"
  | "uid_selection_invalid"
  | "uid_selection_expired"
  | "uid_refresh_exhausted"
  | "uid_unavailable"
  | "uid_already_assigned"
  | "account_banned"
  | "rate_limited"
  | "service_unavailable";

export function authError(code: AuthErrorCode, statusCode = 400): Error {
  return Object.assign(new Error(code), { code, statusCode });
}
