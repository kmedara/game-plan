/**
 * Apple's own "Continue with Apple" button, which App Review expects on iOS.
 *
 * Only the button is native: the press starts the same Cognito sign-in as
 * every other platform.
 */

import {
  AppleAuthenticationButton,
  AppleAuthenticationButtonStyle,
  AppleAuthenticationButtonType,
} from 'expo-apple-authentication';

export const AppleSignInButton = ({ onPress }: { label: string; onPress: () => void }) => (
  <AppleAuthenticationButton
    buttonType={AppleAuthenticationButtonType.CONTINUE}
    buttonStyle={AppleAuthenticationButtonStyle.BLACK}
    cornerRadius={8}
    style={{ height: 48, width: '100%' }}
    onPress={onPress}
  />
);
