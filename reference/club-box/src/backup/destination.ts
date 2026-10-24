export type BackupLocation = {
  location: string;
};

/**
 * Where a SQLite backup file is copied after the online backup finishes.
 * Local disk is the default. S3-compatible storage is optional.
 */
export interface BackupDestination {
  readonly id: string;
  put(name: string, filePath: string): Promise<BackupLocation>;
  get(name: string, destPath: string): Promise<void>;
}
