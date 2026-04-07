module.exports = ({ config }) => ({
  ...config,
  plugins: [...(config.plugins ?? []), '@maplibre/maplibre-react-native'],
  owner: "cptcabbage",
  newArchEnabled: true,
  android: {
    ...config.android,
    package: "com.cptcabbage.nudge",
    config: {
      googleMaps: {
        apiKey: process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY,
      },
    },
  },
  extra: {
    ...config.extra,
    googlePlacesApiKey: process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY,
    eas: {
      projectId: "6144d847-3dbb-460b-b1d8-a6ad56bcd254",
    },
  },
})