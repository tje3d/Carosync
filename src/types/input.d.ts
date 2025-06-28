declare module 'input' {
  interface InputOptions {
    default?: string;
    required?: boolean;
    hidden?: boolean;
  }

  interface Input {
    text(prompt: string, options?: InputOptions): Promise<string>;
    password(prompt: string, options?: InputOptions): Promise<string>;
    confirm(prompt: string, options?: InputOptions): Promise<boolean>;
  }

  const input: Input;
  export = input;
}