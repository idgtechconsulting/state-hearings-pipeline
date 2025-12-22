import ora, { Ora } from "ora";

let spinner: Ora | null = null;

export function startSpinner(text: string) {
  spinner = ora(text).start();
}

export function updateSpinner(text: string) {
  if (spinner) spinner.text = text;
}

export function succeedSpinner(text: string) {
  if (spinner) spinner.succeed(text);
  spinner = null;
}

export function failSpinner(text: string) {
  if (spinner) spinner.fail(text);
  spinner = null;
}
