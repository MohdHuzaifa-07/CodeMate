import { Link, Route, Routes } from 'react-router-dom';
import HomePage from './pages/HomePage.jsx';
import RoomPage from './pages/RoomPage.jsx';
import CenteredMessage from './components/CenteredMessage.jsx';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/room/:roomId" element={<RoomPage />} />
      <Route
        path="*"
        element={
          <CenteredMessage title="Page not found" text="That page does not exist.">
            <Link to="/" className="btn btn-primary">
              Back to home
            </Link>
          </CenteredMessage>
        }
      />
    </Routes>
  );
}