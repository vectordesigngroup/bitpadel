type LogFields = Record<string, string | number | boolean | null>;

export function log(level: "info" | "error", msg: string, fields?: LogFields): void {
  const line = JSON.stringify({
    time: new Date().toISOString(),
    level,
    msg,
    ...fields,
  });
  if (level === "error") console.error(line);
  else console.log(line);
}
