import { StatusBar } from 'expo-status-bar';
import HomeScreen from './src/ui/screens/HomeScreen';

export default function App() {
  return (
    <>
      <HomeScreen />
      <StatusBar style="auto" />
    </>
  );
}
