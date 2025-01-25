import { BrowserRouter as Router, Routes, Route } from "react-router-dom";
import LandingPage from "./pages/LandingPage";
import TextChatPage from "./pages/TextChatPage";
import VideoChatPage from "./pages/VideoChatPage";

export default function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/text-chat" element={<TextChatPage />} />
        <Route path="/video-chat" element={<VideoChatPage />} />
      </Routes>
    </Router>
  );
}
