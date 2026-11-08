export function parseReviewRangeArguments(args, usage) {
  const usageError = () => new Error(`Usage: ${usage} --base <ref> --head <ref>`);
  const values = new Map();
  for (let index = 0; index < args.length; index += 2) {
    const flag = args[index];
    const value = args[index + 1];
    if ((flag !== "--base" && flag !== "--head") || !value) {
      throw usageError();
    }
    values.set(flag.slice(2), value);
  }

  const base = values.get("base");
  const head = values.get("head");
  if (!base || !head) {
    throw usageError();
  }
  return { base, head };
}
