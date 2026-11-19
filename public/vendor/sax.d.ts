interface NamespacedAttribute {
  name: string;
  value: string;
  uri: string;
  local: string;
}

interface SaxParser<Attribute> {
  onopentag?: (tag: { name: string; attributes: Record<string, Attribute> }) => void;
  onclosetag?: (name: string) => void;
  ontext?: (value: string) => void;
  oncdata?: (value: string) => void;
  oncomment?: (value: string) => void;
  ondoctype?: (value: string) => void;
  onprocessinginstruction?: (instruction: { name: string; body: string }) => void;
  write(source: string): SaxParser<Attribute>;
  close(): SaxParser<Attribute>;
}

export function parser(strict: boolean, options: { xmlns: true }): SaxParser<NamespacedAttribute>;
export function parser(strict?: boolean, options?: { xmlns?: false }): SaxParser<string>;
