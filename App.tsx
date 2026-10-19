import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/auth/AuthProvider';
import { authRequiredFromBundle } from './src/auth/runtimeConfig';
import { AuthFlow } from './src/ui/auth/AuthFlow';
import HomeScreen from './src/ui/screens/HomeScreen';

export default function App() {
  if (!authRequiredFromBundle()) {
    return (
      <>
        <HomeScreen />
        <StatusBar style="auto" />
      </>
    );
  }
  return (
    <AuthProvider>
      <AuthFlow />
      <StatusBar style="auto" />
    </AuthProvider>
  );
}
