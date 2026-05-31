// Shared primitive aliases and structural building blocks used across this package.

export type ID = string;

export type ISODateString = string;

export interface Timestamped {
  createdAt: ISODateString;
  updatedAt: ISODateString;
}

export interface NamedEntity extends Timestamped {
  id: ID;
  name: string;
  description?: string | null;
}

export interface ApiError {
  error: string;
  stack?: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}
