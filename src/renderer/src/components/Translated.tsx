import { useTranslated } from '../lib/translate';

export function Translated({ text }: { text: string | null | undefined }) {
  const t = useTranslated(text);
  return <span title={t.auto ? `Traduzido automaticamente. Original: ${text}` : undefined}>{t.text}</span>;
}
