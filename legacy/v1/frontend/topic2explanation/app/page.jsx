import Main from "./components/main";
import Nav from "./components/nav";

export default function Home() {
  return (
    <div className="flex flex-col h-screen">
      <Nav />
      <Main />
    </div>
  );
}
