"use client";

// Shares the signed-in user's role (owner vs workshop staff) down the tree.
// AuthGate resolves `owner` from staff.role and provides it; components read it
// with useOwner() to hide money/admin from non-owner (workshop) logins.

import { createContext, useContext } from "react";

export const RoleContext = createContext({ owner: false });

export function useOwner() {
  return useContext(RoleContext).owner;
}
