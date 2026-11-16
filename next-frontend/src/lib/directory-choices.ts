import type { components } from "@/generated/api";
import type { FilterKey } from "@/lib/directory-url";
import { LEVEL_LABELS, STATUS_LABELS } from "@/lib/format";

export const FILTER_LABELS: Record<FilterKey, string> = {
  department: "Department",
  country: "Country",
  currency: "Currency",
  level: "Level",
  status: "Employment status",
};

export type FilterChoices = Record<FilterKey, { value: string; label: string }[]>;

/** Filter choices from the permission-filtered options response, and nothing else. */
export function buildFilterChoices(options: components["schemas"]["DirectoryOptionsResponse"]): FilterChoices {
  return {
    department: options.departments.map((value) => ({ value, label: value })),
    country: options.countries.map(({ code, name }) => ({ value: code, label: name })),
    currency: options.currencies.map((value) => ({ value, label: value })),
    level: options.levels.map((value) => ({ value, label: LEVEL_LABELS[value] })),
    status: options.statuses.map((value) => ({ value, label: STATUS_LABELS[value] })),
  };
}

/** Text for an active filter chip; falls back to the raw value when it is not an option. */
export function filterValueLabel(choices: FilterChoices, key: FilterKey, value: string): string {
  return choices[key].find((choice) => choice.value === value)?.label ?? value;
}
