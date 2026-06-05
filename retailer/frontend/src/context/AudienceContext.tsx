import { createContext, useContext, useState, type ReactNode } from "react";

export interface AudienceFilters {
  segments: string[];
  states: string[];
  loyaltyTiers: string[];
  gender: string;
  minSpend: number;
  recencyDays: number;
}

export interface AudienceState {
  filters: AudienceFilters;
  audienceSize: number;
  reachable: number;
  audienceLabel: string;
}

interface AudienceContextType {
  state: AudienceState;
  setFilters: (f: AudienceFilters) => void;
  setAudienceSize: (n: number) => void;
  setReachable: (n: number) => void;
  setAudienceLabel: (s: string) => void;
}

const DEFAULT_FILTERS: AudienceFilters = { segments: [], states: [], loyaltyTiers: [], gender: "All", minSpend: 0, recencyDays: 730 };

const AudienceContext = createContext<AudienceContextType>({
  state: { filters: DEFAULT_FILTERS, audienceSize: 0, reachable: 0, audienceLabel: "All Customers" },
  setFilters: () => {},
  setAudienceSize: () => {},
  setReachable: () => {},
  setAudienceLabel: () => {},
});

export function AudienceProvider({ children }: { children: ReactNode }) {
  const [filters, setFilters] = useState<AudienceFilters>(DEFAULT_FILTERS);
  const [audienceSize, setAudienceSize] = useState(0);
  const [reachable, setReachable] = useState(0);
  const [audienceLabel, setAudienceLabel] = useState("All Customers");

  return (
    <AudienceContext.Provider value={{
      state: { filters, audienceSize, reachable, audienceLabel },
      setFilters, setAudienceSize, setReachable, setAudienceLabel,
    }}>
      {children}
    </AudienceContext.Provider>
  );
}

export function useAudience() {
  return useContext(AudienceContext);
}

export { DEFAULT_FILTERS };
