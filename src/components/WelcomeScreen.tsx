import { Button } from "@heroui/react";
import appIcon from "@assets/app-icon.png";

type WelcomeScreenProps = {
  onContinue: () => void;
};

export default function WelcomeScreen({ onContinue }: WelcomeScreenProps) {
  return (
    <main className="welcome" aria-labelledby="welcome-title">
      <div className="welcome__dots" aria-hidden="true" />
      <section className="welcome__content">
        <img src={appIcon} alt="" className="welcome__icon" aria-hidden="true" />
        <p className="welcome__greeting">初次见面</p>
        <h1 id="welcome-title">欢迎使用美美工具箱！</h1>
        <p className="welcome__description">
          你知道吗，“美美”是《与你相恋到生命尽头》中一名粉色可爱小女孩。
        </p>
        <Button className="welcome__continue" onPress={onContinue} variant="primary">
          开始使用
        </Button>
      </section>
    </main>
  );
}
