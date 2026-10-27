import { StatusBar } from 'expo-status-bar';
import { AuthProvider } from './src/auth/AuthProvider';
import { authRequiredFromBundle } from './src/auth/runtimeConfig';
import { AuthFlow } from './src/ui/auth/AuthFlow';
import EngineeringToolsScreen from './src/ui/screens/EngineeringToolsScreen';

export default function App() {
  if (!authRequiredFromBundle()) {
    return (
      <>
        <EngineeringToolsScreen />
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
