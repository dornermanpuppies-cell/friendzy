/** Spoken languages (ISO 639-1). Stored per user in `user_languages.code`. */
export interface LanguageItem {
  code: string;
  name: string;
  native: string;
}

export const MAX_LANGUAGES = 6;

export const LANGUAGES: LanguageItem[] = [
  { code: 'en', name: 'English', native: 'English' },
  { code: 'es', name: 'Spanish', native: 'Español' },
  { code: 'fr', name: 'French', native: 'Français' },
  { code: 'de', name: 'German', native: 'Deutsch' },
  { code: 'pt', name: 'Portuguese', native: 'Português' },
  { code: 'it', name: 'Italian', native: 'Italiano' },
  { code: 'nl', name: 'Dutch', native: 'Nederlands' },
  { code: 'ru', name: 'Russian', native: 'Русский' },
  { code: 'uk', name: 'Ukrainian', native: 'Українська' },
  { code: 'pl', name: 'Polish', native: 'Polski' },
  { code: 'cs', name: 'Czech', native: 'Čeština' },
  { code: 'sk', name: 'Slovak', native: 'Slovenčina' },
  { code: 'hu', name: 'Hungarian', native: 'Magyar' },
  { code: 'ro', name: 'Romanian', native: 'Română' },
  { code: 'bg', name: 'Bulgarian', native: 'Български' },
  { code: 'el', name: 'Greek', native: 'Ελληνικά' },
  { code: 'tr', name: 'Turkish', native: 'Türkçe' },
  { code: 'sv', name: 'Swedish', native: 'Svenska' },
  { code: 'no', name: 'Norwegian', native: 'Norsk' },
  { code: 'da', name: 'Danish', native: 'Dansk' },
  { code: 'fi', name: 'Finnish', native: 'Suomi' },
  { code: 'is', name: 'Icelandic', native: 'Íslenska' },
  { code: 'et', name: 'Estonian', native: 'Eesti' },
  { code: 'lv', name: 'Latvian', native: 'Latviešu' },
  { code: 'lt', name: 'Lithuanian', native: 'Lietuvių' },
  { code: 'sr', name: 'Serbian', native: 'Српски' },
  { code: 'hr', name: 'Croatian', native: 'Hrvatski' },
  { code: 'bs', name: 'Bosnian', native: 'Bosanski' },
  { code: 'sl', name: 'Slovenian', native: 'Slovenščina' },
  { code: 'mk', name: 'Macedonian', native: 'Македонски' },
  { code: 'sq', name: 'Albanian', native: 'Shqip' },
  { code: 'ca', name: 'Catalan', native: 'Català' },
  { code: 'ga', name: 'Irish', native: 'Gaeilge' },
  { code: 'ar', name: 'Arabic', native: 'العربية' },
  { code: 'he', name: 'Hebrew', native: 'עברית' },
  { code: 'fa', name: 'Persian', native: 'فارسی' },
  { code: 'ur', name: 'Urdu', native: 'اردو' },
  { code: 'hi', name: 'Hindi', native: 'हिन्दी' },
  { code: 'bn', name: 'Bengali', native: 'বাংলা' },
  { code: 'pa', name: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'gu', name: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'mr', name: 'Marathi', native: 'मराठी' },
  { code: 'ta', name: 'Tamil', native: 'தமிழ்' },
  { code: 'te', name: 'Telugu', native: 'తెలుగు' },
  { code: 'kn', name: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'ml', name: 'Malayalam', native: 'മലയാളം' },
  { code: 'si', name: 'Sinhala', native: 'සිංහල' },
  { code: 'ne', name: 'Nepali', native: 'नेपाली' },
  { code: 'zh', name: 'Chinese', native: '中文' },
  { code: 'ja', name: 'Japanese', native: '日本語' },
  { code: 'ko', name: 'Korean', native: '한국어' },
  { code: 'vi', name: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'th', name: 'Thai', native: 'ไทย' },
  { code: 'id', name: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'ms', name: 'Malay', native: 'Bahasa Melayu' },
  { code: 'tl', name: 'Filipino', native: 'Filipino' },
  { code: 'km', name: 'Khmer', native: 'ខ្មែរ' },
  { code: 'my', name: 'Burmese', native: 'မြန်မာ' },
  { code: 'mn', name: 'Mongolian', native: 'Монгол' },
  { code: 'kk', name: 'Kazakh', native: 'Қазақ' },
  { code: 'uz', name: 'Uzbek', native: 'Oʻzbek' },
  { code: 'az', name: 'Azerbaijani', native: 'Azərbaycan' },
  { code: 'ka', name: 'Georgian', native: 'ქართული' },
  { code: 'hy', name: 'Armenian', native: 'Հայերեն' },
  { code: 'sw', name: 'Swahili', native: 'Kiswahili' },
  { code: 'am', name: 'Amharic', native: 'አማርኛ' },
  { code: 'ha', name: 'Hausa', native: 'Hausa' },
  { code: 'yo', name: 'Yoruba', native: 'Yorùbá' },
  { code: 'ig', name: 'Igbo', native: 'Igbo' },
  { code: 'zu', name: 'Zulu', native: 'isiZulu' },
  { code: 'xh', name: 'Xhosa', native: 'isiXhosa' },
  { code: 'af', name: 'Afrikaans', native: 'Afrikaans' },
  { code: 'so', name: 'Somali', native: 'Soomaali' },
  { code: 'rw', name: 'Kinyarwanda', native: 'Ikinyarwanda' },
  { code: 'mg', name: 'Malagasy', native: 'Malagasy' },
  { code: 'ht', name: 'Haitian Creole', native: 'Kreyòl ayisyen' },
  { code: 'eo', name: 'Esperanto', native: 'Esperanto' },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

export function getLanguage(code: string | null | undefined): LanguageItem | undefined {
  return code ? BY_CODE.get(code.toLowerCase()) : undefined;
}

export function languageName(code: string): string {
  return getLanguage(code)?.name ?? code.toUpperCase();
}

export function languageNames(codes: string[] | null | undefined, max = 3): string {
  if (!codes || codes.length === 0) return '';
  const names = codes.slice(0, max).map(languageName);
  const rest = codes.length - names.length;
  return rest > 0 ? `${names.join(', ')} +${rest}` : names.join(', ');
}
