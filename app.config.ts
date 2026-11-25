import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Friendzy — Expo app configuration.
 *
 * All secrets live in environment variables. Only EXPO_PUBLIC_* values are ever
 * bundled into the client (see .env.example and docs/CONFIGURATION.md).
 */
export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Friendzy',
  slug: 'friendzy',
  owner: process.env.EXPO_OWNER,
  version: '0.1.0',
  orientation: 'portrait',
  icon: './assets/images/icon.png',
  scheme: 'friendzy',
  userInterfaceStyle: 'automatic',
  primaryColor: '#7000FF',
  backgroundColor: '#090817',
  ios: {
    bundleIdentifier: 'com.friendzy.app',
    supportsTablet: true,
    associatedDomains: process.env.EXPO_PUBLIC_WEB_HOST
      ? [`applinks:${process.env.EXPO_PUBLIC_WEB_HOST}`]
      : undefined,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
      NSPhotoLibraryUsageDescription:
        'Friendzy needs access to your photos so you can choose a profile picture and share moments.',
      NSCameraUsageDescription:
        'Friendzy uses your camera for profile photos, videos, video calls and live broadcasts.',
      NSMicrophoneUsageDescription:
        'Friendzy uses your microphone for voice notes, calls and live broadcasts.',
      NSLocationWhenInUseUsageDescription:
        'Friendzy can use your approximate location to show people nearby. This is optional.',
    },
  },
  android: {
    package: 'com.friendzy.app',
    // Monotonic build number for sideloaded APKs (GitHub Actions passes its run number);
    // EAS production builds manage their own version code remotely.
    versionCode: Number.parseInt(process.env.ANDROID_VERSION_CODE ?? '', 10) || 1,
    predictiveBackGestureEnabled: false,
    adaptiveIcon: {
      backgroundColor: '#35006B',
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
    },
    permissions: [
      'android.permission.CAMERA',
      'android.permission.RECORD_AUDIO',
      'android.permission.READ_MEDIA_IMAGES',
      'android.permission.READ_MEDIA_VIDEO',
      'android.permission.POST_NOTIFICATIONS',
    ],
    intentFilters: process.env.EXPO_PUBLIC_WEB_HOST
      ? [
          {
            action: 'VIEW',
            autoVerify: true,
            data: [{ scheme: 'https', host: process.env.EXPO_PUBLIC_WEB_HOST, pathPrefix: '/' }],
            category: ['BROWSABLE', 'DEFAULT'],
          },
        ]
      : undefined,
  },
  web: {
    // Static HTML per route: SEO for the public website, client-side hydration for the app.
    output: 'static',
    bundler: 'metro',
    favicon: './assets/images/favicon.png',
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        backgroundColor: '#090817',
        image: './assets/images/splash-icon.png',
        imageWidth: 140,
      },
    ],
    'expo-secure-store',
    'expo-localization',
    'expo-web-browser',
    [
      'expo-image-picker',
      {
        photosPermission:
          'Friendzy needs access to your photos so you can choose a profile picture and share moments.',
        cameraPermission:
          'Friendzy uses your camera for profile photos, videos, video calls and live broadcasts.',
      },
    ],
    [
      'expo-notifications',
      {
        color: '#7000FF',
        defaultChannel: 'default',
      },
    ],
    'expo-video',
    'expo-audio',
    'expo-sharing',
    [
      'expo-camera',
      {
        cameraPermission: 'Friendzy uses your camera for profile photos, videos, video calls and live broadcasts.',
        microphonePermission: 'Friendzy uses your microphone for voice notes, calls and live broadcasts.',
        recordAudioAndroid: true,
      },
    ],
    [
      'expo-location',
      {
        locationWhenInUsePermission: 'Friendzy can use your approximate location to show people nearby. This is optional.',
        isAndroidBackgroundLocationEnabled: false,
      },
    ],
    // LiveKit (calls + livestreams) — native WebRTC. Requires a development build.
    '@livekit/react-native-expo-plugin',
    '@config-plugins/react-native-webrtc',
    // Release signing from FRIENDZY_UPLOAD_* Gradle properties (CI); debug keystore fallback.
    './plugins/withAndroidReleaseSigning',
  ],
  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },
  extra: {
    eas: {
      projectId: process.env.EAS_PROJECT_ID,
    },
  },
});
