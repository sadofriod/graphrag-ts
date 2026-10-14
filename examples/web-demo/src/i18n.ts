import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import english from './locales/en-US.json';
import chinese from './locales/zh-CN.json';

export const languageStorageKey = 'graphrag-web-demo-language';
export const supportedLanguages = ['en-US', 'zh-CN'] as const;
export type SupportedLanguage = (typeof supportedLanguages)[number];

const getInitialLanguage = (): SupportedLanguage => {
  const storedLanguage = localStorage.getItem(languageStorageKey);
  if (storedLanguage === 'en-US' || storedLanguage === 'zh-CN') {
    return storedLanguage;
  }
  return navigator.language.toLowerCase().startsWith('zh') ? 'zh-CN' : 'en-US';
};

const initialLanguage = getInitialLanguage();

void i18n.use(initReactI18next).init({
  resources: {
    'en-US': { translation: english },
    'zh-CN': { translation: chinese },
  },
  lng: initialLanguage,
  fallbackLng: 'en-US',
  interpolation: { escapeValue: false },
});

document.documentElement.lang = initialLanguage;
i18n.on('languageChanged', (language) => {
  document.documentElement.lang = language;
});

export default i18n;