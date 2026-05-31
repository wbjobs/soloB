import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import { Navbar } from './components/Navbar';
import { RecorderConsole } from './components/RecorderConsole';
import { SessionsPage } from './pages/SessionsPage';
import { VideoPlayerPage } from './pages/VideoPlayerPage';

function App() {
  return (
    <Router>
      <div className="min-h-screen bg-slate-900">
        <Navbar />
        <Routes>
          <Route path="/" element={<RecorderConsole />} />
          <Route path="/sessions" element={<SessionsPage />} />
          <Route path="/sessions/:id" element={<VideoPlayerPage />} />
        </Routes>
      </div>
    </Router>
  );
}

export default App;
