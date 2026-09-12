import { useRoute, isAppRoute } from './shell/router'
import { Landing } from './landing/Landing'
import { AuthScreen } from './landing/AuthScreen'
import AppShell from './shell/AppShell'
import { EchoStoreProvider } from './shell/store'
import { LiveHudHost } from './components/LiveHudHost'

/** Global live state is mounted once. Capture still requires a user gesture. */
export default function Root() {
  const route = useRoute()

  return <EchoStoreProvider>
    <div hidden={!isAppRoute(route)}><AppShell /></div>
    {route === '/login' ? <AuthScreen mode="login" /> : route === '/signup' ? <AuthScreen mode="signup" /> : !isAppRoute(route) ? <Landing /> : null}
    <LiveHudHost />
  </EchoStoreProvider>
}
