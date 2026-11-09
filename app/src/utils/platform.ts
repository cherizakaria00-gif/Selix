import { router, type Href } from 'expo-router';
import { Alert, Linking, Platform, useWindowDimensions } from 'react-native';

/** Sur le web, l'app sert de tableau de bord admin (app.selix.io). */
export const isWeb = Platform.OS === 'web';

/** Écran assez large pour la mise en page bureau (menu latéral). */
export function useIsDesktop() {
  const { width } = useWindowDimensions();
  return isWeb && width >= 900;
}

// Alert.alert ne fait rien dans un navigateur : on passe par les boîtes du navigateur.

export function notify(title: string, message?: string) {
  if (isWeb) window.alert(message ? `${title}\n\n${message}` : title);
  else Alert.alert(title, message);
}

export function confirmAction(title: string, message: string, confirmLabel: string, cancelLabel = 'Annuler', destructive = true): Promise<boolean> {
  if (isWeb) return Promise.resolve(window.confirm(`${title}\n\n${message}`));
  return new Promise((resolve) =>
    Alert.alert(title, message, [
      { text: cancelLabel, style: 'cancel', onPress: () => resolve(false) },
      { text: confirmLabel, style: destructive ? 'destructive' : 'default', onPress: () => resolve(true) },
    ], { cancelable: false }),
  );
}

/** Ouvre la politique de confidentialité publiée sur le site. */
export function openPrivacyPolicy() {
  return Linking.openURL('https://selix.io/fr/privacy/');
}

/** Revient en arrière ; sur le web, une page ouverte par son adresse n'a pas d'historique. */
export function goBack(fallback: Href) {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
