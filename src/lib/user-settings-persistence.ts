import { doc, getDoc, setDoc, onSnapshot, Unsubscribe } from 'firebase/firestore';
import { db } from './firebase';
import { AIDraftingPreferences, AIProvider } from '@/types';

export interface TTSSettings {
  voice: string;
  speed: number;
  useNaturalVoice: boolean;
}

export interface UserSettings {
  // AI Settings
  aiProvider: AIProvider;
  aiModel: string;
  aiDraftingPreferences: AIDraftingPreferences;

  // TTS Settings
  ttsSettings: TTSSettings;

  // Metadata
  lastUpdated: Date;
}

const DEFAULT_USER_SETTINGS: UserSettings = {
  aiProvider: 'anthropic',
  aiModel: 'claude-sonnet-4-20250514',
  aiDraftingPreferences: {
    userName: '',
    tones: ['professional', 'friendly'],
    length: undefined,
    useExclamations: undefined,
    signOffStyle: 'best',
    customSignOff: '',
    customInstructions: '',
  },
  ttsSettings: {
    voice: 'nova',
    speed: 1.0,
    useNaturalVoice: true,
  },
  lastUpdated: new Date(),
};

/**
 * Get user settings from Firestore
 */
export async function getUserSettings(userId: string): Promise<UserSettings> {
  try {
    const docRef = doc(db, 'users', userId, 'settings', 'preferences');
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        ...DEFAULT_USER_SETTINGS,
        ...data,
        lastUpdated: data.lastUpdated?.toDate() || new Date(),
      };
    }

    // If no settings exist, return defaults
    return DEFAULT_USER_SETTINGS;
  } catch (error) {
    console.error('Error fetching user settings:', error);
    return DEFAULT_USER_SETTINGS;
  }
}

/**
 * Save user settings to Firestore
 */
export async function saveUserSettings(userId: string, settings: Partial<UserSettings>): Promise<void> {
  try {
    const docRef = doc(db, 'users', userId, 'settings', 'preferences');

    // Get current settings to merge with updates
    const current = await getUserSettings(userId);

    // Deep merge for nested objects like aiDraftingPreferences
    const updated: UserSettings = {
      ...current,
      ...settings,
      aiDraftingPreferences: {
        ...current.aiDraftingPreferences,
        ...(settings.aiDraftingPreferences || {}),
      },
      ttsSettings: {
        ...current.ttsSettings,
        ...(settings.ttsSettings || {}),
      },
      lastUpdated: new Date(),
    };

    await setDoc(docRef, updated);
  } catch (error) {
    console.error('Error saving user settings:', error);
    throw error;
  }
}

/**
 * Subscribe to user settings changes in Firestore
 * Returns an unsubscribe function
 */
export function subscribeToUserSettings(
  userId: string,
  onSettingsChange: (settings: UserSettings) => void
): Unsubscribe {
  const docRef = doc(db, 'users', userId, 'settings', 'preferences');

  return onSnapshot(docRef, (docSnap) => {
    if (docSnap.exists()) {
      const data = docSnap.data();
      const settings: UserSettings = {
        ...DEFAULT_USER_SETTINGS,
        ...data,
        lastUpdated: data.lastUpdated?.toDate() || new Date(),
      };
      onSettingsChange(settings);
    } else {
      // If no settings exist, use defaults
      onSettingsChange(DEFAULT_USER_SETTINGS);
    }
  }, (error) => {
    console.error('Error subscribing to user settings:', error);
  });
}

/**
 * Migrate settings from localStorage to Firestore (one-time migration)
 */
export async function migrateSettingsFromLocalStorage(userId: string): Promise<void> {
  try {
    // Check if we've already migrated
    const docRef = doc(db, 'users', userId, 'settings', 'preferences');
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
      // Settings already exist in Firestore, no need to migrate
      return;
    }

    // Get settings from localStorage
    const settings: Partial<UserSettings> = {};

    // Get drafting preferences
    const draftingPrefsStr = localStorage.getItem('flomail-drafting-preferences');
    if (draftingPrefsStr) {
      try {
        const parsed = JSON.parse(draftingPrefsStr);
        // Remove deprecated fields
        delete parsed.userRole;
        delete parsed.userOrganization;
        settings.aiDraftingPreferences = parsed;
      } catch {}
    }

    // Get TTS settings
    const ttsSettingsStr = localStorage.getItem('flomail_tts_settings');
    if (ttsSettingsStr) {
      try {
        settings.ttsSettings = JSON.parse(ttsSettingsStr);
      } catch {}
    }

    // Save to Firestore if we have any settings to migrate
    if (Object.keys(settings).length > 0) {
      await saveUserSettings(userId, settings);
      console.log('Successfully migrated settings from localStorage to Firestore');
    }
  } catch (error) {
    console.error('Error migrating settings from localStorage:', error);
  }
}