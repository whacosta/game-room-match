import { Navigate, Route, Routes } from 'react-router-dom'
import AuthPage from './pages/AuthPage'
import CreateRoomPage from './pages/CreateRoomPage'
import HomePage from './pages/HomePage'
import JoinPage from './pages/JoinPage'
import ProfilePage from './pages/ProfilePage'
import RoomPage from './pages/RoomPage'

function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/auth" element={<AuthPage />} />
      <Route path="/create" element={<CreateRoomPage />} />
      <Route path="/room/:slug" element={<RoomPage />} />
      <Route path="/room/:slug/profile" element={<ProfilePage />} />
      <Route path="/join/:slug" element={<JoinPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}

export default App
