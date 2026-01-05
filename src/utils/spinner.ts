import ora, { Ora } from "ora";

// Keep a single spinner instance across updates
let spinner: Ora | null = null;

export function startSpinner(text: string) {
  // Start a new spinner with initial text
  spinner = ora(text).start();
}

export function updateSpinner(text: string) {
  // Update text only if a spinner exists
  if (spinner) spinner.text = text;
}

export function succeedSpinner(text: string) {
  // Mark spinner as success and clear it
  if (spinner) spinner.succeed(text);
  spinner = null;
}

export function failSpinner(text: string) {
  // Mark spinner as failed and clear it
  if (spinner) spinner.fail(text);
  spinner = null;
}
