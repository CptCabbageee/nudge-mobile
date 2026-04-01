module.exports = ({ config }) => ({
  ...config,
  extra: {
    googlePlacesApiKey: process.env.EXPO_PUBLIC_GOOGLE_PLACES_API_KEY,
  },
})
