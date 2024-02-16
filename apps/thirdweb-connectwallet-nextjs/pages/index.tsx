import { ConnectWallet, useAddress } from "@thirdweb-dev/react";
import styles from "../styles/Home.module.css";
import Image from "next/image";
import { NextPage } from "next";

const Home: NextPage = () => {
  const address = useAddress();
  console.log(address);

  return (
    <div className={styles.container}>
      <main className={styles.main}>
        <ConnectWallet
          theme="light"
          btnTitle="Bera Connect"
          className={styles.beraWallet}
        />
      </main>
    </div>
  );
};

export default Home;
