import ChatApp from "@/components/ChatApp";
import { LoginGate } from "@/components/LoginGate";

export default function Home() {
  return (
    <LoginGate>
      <ChatApp />
    </LoginGate>
  );
}
