export interface Patient {
  id: string;
  code: string;
  createdAt: string;
}

// Storage/auth/database are NOT implemented in bootstrap.
// TODO (Phase 1+): define patient repository interface + local persistence.
export {};
