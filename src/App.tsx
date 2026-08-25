import { Link, Route, Routes } from 'react-router-dom'

function Home() {
  return (
    <main>
      <h1>Game Room Match</h1>
      <p>Encuentra el juego perfecto para compartir con tu grupo.</p>
      <Link to="/">Inicio</Link>
    </main>
  )
}

function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  )
}

export default App
