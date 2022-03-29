import type { SignerWithAddress } from "@nomiclabs/hardhat-ethers/dist/src/signer-with-address";
import { expect } from "chai";
import { BigNumberish, Signature } from "ethers";
import { artifacts, ethers, waffle } from "hardhat";
import type { Artifact } from "hardhat/types";
import type { ERC1238Mock } from "../../src/types/ERC1238Mock";
import type { ERC1238ReceiverMock } from "../../src/types/ERC1238ReceiverMock";
import { toBN, TOKEN_ID_ZERO, ZERO_ADDRESS } from "../utils/test-utils";

const BASE_URI = "https://token-cdn-domain/{id}.json";

function isBigNumberish(bn: BigNumberish | BigNumberish[]): bn is BigNumberish {
  return !Array.isArray(bn);
}

const getMintApprovalSignature = async ({
  signer,
  erc1238Contract,
  to,
  ids,
  amounts,
}: {
  signer: SignerWithAddress;
  erc1238Contract: ERC1238Mock;
  to: string;
  ids: BigNumberish | BigNumberish[];
  amounts: BigNumberish | BigNumberish[];
}): Promise<Signature> => {
  let hash;
  if (!isBigNumberish(ids) && !isBigNumberish(amounts)) {
    hash = await erc1238Contract["getMintApprovalMessageHash(address,uint256[],uint256[])"](to, ids, amounts);
  } else if (isBigNumberish(ids) && isBigNumberish(amounts)) {
    hash = await erc1238Contract["getMintApprovalMessageHash(address,uint256,uint256)"](to, ids, amounts);
  } else {
    hash = "0x";
  }
  const bytesHash = ethers.utils.arrayify(hash);
  const sig = await signer.signMessage(bytesHash);

  return ethers.utils.splitSignature(sig);
};

describe("ERC1238", function () {
  let erc1238Mock: ERC1238Mock;
  let admin: SignerWithAddress;
  let tokenRecipient: SignerWithAddress;
  let tokenBatchRecipient: SignerWithAddress;
  let smartContractRecipient: ERC1238ReceiverMock;

  before(async function () {
    const signers: SignerWithAddress[] = await ethers.getSigners();
    admin = signers[0];
    tokenRecipient = signers[1];
    tokenBatchRecipient = signers[2];
  });

  beforeEach(async function () {
    const ERC1238MockArtifact: Artifact = await artifacts.readArtifact("ERC1238Mock");
    erc1238Mock = <ERC1238Mock>await waffle.deployContract(admin, ERC1238MockArtifact, [BASE_URI]);
    const ERC1238ReceiverMockArtifact: Artifact = await artifacts.readArtifact("ERC1238ReceiverMock");
    smartContractRecipient = <ERC1238ReceiverMock>(
      await waffle.deployContract(tokenRecipient, ERC1238ReceiverMockArtifact)
    );
  });

  describe("internal functions", () => {
    const data = "0x12345678";
    const tokenId = toBN("11223344");
    const mintAmount = toBN("58319");
    const burnAmount = toBN("987");

    const tokenBatchIds = [toBN("2000"), toBN("2010"), toBN("2020")];
    const mintBatchAmounts = [toBN("5000"), toBN("10000"), toBN("42195")];
    const burnBatchAmounts = [toBN("5000"), toBN("9001"), toBN("195")];

    /*
     * MINTING
     */

    describe("_mintToEOA", () => {
      let v: number;
      let r: string;
      let s: string;
      beforeEach(async () => {
        ({ v, r, s } = await getMintApprovalSignature({
          signer: tokenRecipient,
          erc1238Contract: erc1238Mock,
          to: tokenRecipient.address,
          ids: tokenId,
          amounts: mintAmount,
        }));
      });

      it("should revert with an invalid signature", async () => {
        await expect(
          erc1238Mock.connect(admin).mintToEOA(ZERO_ADDRESS, tokenId, mintAmount, v, r, s, data),
        ).to.be.revertedWith("ERC1238: Invalid signature for minting approval");
      });

      it("should credit the amount of tokens", async () => {
        await erc1238Mock.mintToEOA(tokenRecipient.address, tokenId, mintAmount, v, r, s, data);

        const balance = await erc1238Mock.balanceOf(tokenRecipient.address, tokenId);

        expect(balance).to.eq(mintAmount);
      });

      it("should emit a MintSingle event", async () => {
        await expect(erc1238Mock.mintToEOA(tokenRecipient.address, tokenId, mintAmount, v, r, s, data))
          .to.emit(erc1238Mock, "MintSingle")
          .withArgs(admin.address, tokenRecipient.address, tokenId, mintAmount);
      });
    });

    describe("_mintToContract", () => {
      it("should credit the amount of tokens", async () => {
        await erc1238Mock.mintToContract(smartContractRecipient.address, tokenId, mintAmount, data);

        const balance = await erc1238Mock.balanceOf(smartContractRecipient.address, tokenId);

        expect(balance).to.eq(mintAmount);
      });

      it("should revert if the smart contract does not accept the tokens", async () => {
        // ERC1238ReceiverMock is set to reject tokens with id 0
        await expect(
          erc1238Mock.mintToContract(smartContractRecipient.address, TOKEN_ID_ZERO, mintAmount, data),
        ).to.be.revertedWith("ERC1238: ERC1238Receiver rejected tokens");
      });
    });

    // describe("_mintBatch", () => {
    //   let v: number;
    //   let r: string;
    //   let s: string;
    //   beforeEach(async () => {
    //     ({ v, r, s } = await getMintApprovalSignature({
    //       signer: tokenRecipient,
    //       erc1238Contract: erc1238Mock,
    //       to: tokenRecipient.address,
    //       ids: tokenBatchIds,
    //       amounts: mintBatchAmounts,
    //     }));
    //   });
    //   it("should revert with the zero address", async () => {
    //     await expect(
    //       erc1238Mock.connect(admin).mintBatch(ZERO_ADDRESS, tokenBatchIds, mintBatchAmounts, data),
    //     ).to.be.revertedWith("ERC1238: mint to the zero address");
    //   });

    //   it("should revert if the length of inputs do not match", async () => {
    //     await expect(
    //       erc1238Mock
    //         .connect(admin)
    //         .mintBatch(tokenBatchRecipient.address, tokenBatchIds.slice(1), mintBatchAmounts, data),
    //     ).to.be.revertedWith("ERC1238: ids and amounts length mismatch");

    //     await expect(
    //       erc1238Mock
    //         .connect(admin)
    //         .mintBatch(tokenBatchRecipient.address, tokenBatchIds, mintBatchAmounts.slice(1), data),
    //     ).to.be.revertedWith("ERC1238: ids and amounts length mismatch");
    //   });

    //   it("should credit the minted tokens", async () => {
    //     await erc1238Mock.connect(admin).mintBatch(tokenBatchRecipient.address, tokenBatchIds, mintBatchAmounts, data);

    //     tokenBatchIds.forEach(async (tokenId, index) =>
    //       expect(await erc1238Mock.balanceOf(tokenBatchRecipient.address, tokenId)).to.eq(mintBatchAmounts[index]),
    //     );
    //   });

    //   it("should emit a MintBatch event", async () => {
    //     await expect(erc1238Mock.mintBatch(tokenRecipient.address, tokenBatchIds, mintBatchAmounts, data))
    //       .to.emit(erc1238Mock, "MintBatch")
    //       .withArgs(admin.address, tokenRecipient.address, tokenBatchIds, mintBatchAmounts);
    //   });
    // });

    /*
     * BURNING
     */

    // describe("_burn", () => {
    //   it("should revert when buring the zero account's token", async () => {
    //     await expect(erc1238Mock.connect(admin).burn(ZERO_ADDRESS, tokenId, burnAmount)).to.be.revertedWith(
    //       "ERC1238: burn from the zero address",
    //     );
    //   });

    //   it("should revert when buring a non-existent token id", async () => {
    //     await expect(erc1238Mock.connect(admin).burn(tokenRecipient.address, tokenId, burnAmount)).to.be.revertedWith(
    //       "ERC1238: burn amount exceeds balance",
    //     );
    //   });

    //   it("should revert when buring more than available balance", async () => {
    //     const amountToMint = burnAmount.sub(1);
    //     await erc1238Mock.mint(tokenRecipient.address, tokenId, amountToMint, data);

    //     await expect(erc1238Mock.connect(admin).burn(tokenRecipient.address, tokenId, burnAmount)).to.be.revertedWith(
    //       "ERC1238: burn amount exceeds balance",
    //     );
    //   });

    //   it("should burn the right amount of tokens", async () => {
    //     const amountToMint = burnAmount.add(1);

    //     await erc1238Mock.mint(tokenRecipient.address, tokenId, amountToMint, data);

    //     await erc1238Mock.connect(admin).burn(tokenRecipient.address, tokenId, burnAmount);

    //     expect(await erc1238Mock.balanceOf(tokenRecipient.address, tokenId)).to.eq(1);
    //   });

    //   it("should emit a BurnSingle event", async () => {
    //     await erc1238Mock.mint(tokenRecipient.address, tokenId, burnAmount, data);

    //     await expect(erc1238Mock.burn(tokenRecipient.address, tokenId, burnAmount))
    //       .to.emit(erc1238Mock, "BurnSingle")
    //       .withArgs(admin.address, tokenRecipient.address, tokenId, burnAmount);
    //   });
    // });

    // describe("_burnBatch", () => {
    //   it("should revert when buring the zero account's token", async () => {
    //     await expect(
    //       erc1238Mock.connect(admin).burnBatch(ZERO_ADDRESS, tokenBatchIds, burnBatchAmounts),
    //     ).to.be.revertedWith("ERC1238: burn from the zero address");
    //   });

    //   it("should revert if the length of inputs do not match", async () => {
    //     await expect(
    //       erc1238Mock.connect(admin).burnBatch(tokenBatchRecipient.address, tokenBatchIds.slice(1), burnBatchAmounts),
    //     ).to.be.revertedWith("ERC1238: ids and amounts length mismatch");

    //     await expect(
    //       erc1238Mock.connect(admin).burnBatch(tokenBatchRecipient.address, tokenBatchIds, burnBatchAmounts.slice(1)),
    //     ).to.be.revertedWith("ERC1238: ids and amounts length mismatch");
    //   });

    //   it("should revert when burning a non-existent token id", async () => {
    //     await erc1238Mock
    //       .connect(admin)
    //       .mintBatch(tokenRecipient.address, tokenBatchIds.slice(1), burnBatchAmounts.slice(1), data);

    //     await expect(
    //       erc1238Mock.connect(admin).burnBatch(tokenRecipient.address, tokenBatchIds, burnBatchAmounts),
    //     ).to.be.revertedWith("ERC1238: burn amount exceeds balance");
    //   });

    //   it("should properly burn tokens", async () => {
    //     await erc1238Mock.connect(admin).mintBatch(tokenRecipient.address, tokenBatchIds, mintBatchAmounts, data);

    //     await erc1238Mock.connect(admin).burnBatch(tokenRecipient.address, tokenBatchIds, burnBatchAmounts);

    //     tokenBatchIds.forEach(async (tokenId, i) =>
    //       expect(await erc1238Mock.balanceOf(tokenRecipient.address, tokenId)).to.eq(
    //         mintBatchAmounts[i].sub(burnBatchAmounts[i]),
    //       ),
    //     );
    //   });

    //   it("should emit a BurnBatch event", async () => {
    //     await erc1238Mock.mintBatch(tokenRecipient.address, tokenBatchIds, mintBatchAmounts, data);

    //     await expect(erc1238Mock.burnBatch(tokenRecipient.address, tokenBatchIds, burnBatchAmounts))
    //       .to.emit(erc1238Mock, "BurnBatch")
    //       .withArgs(admin.address, tokenRecipient.address, tokenBatchIds, burnBatchAmounts);
    //   });
    // });

    /*
     * URI
     */

    describe("URI", () => {
      it("should set the base URI during construction", async () => {
        expect(await erc1238Mock.baseURI()).to.eq(BASE_URI);
      });

      it("should set a new base URI", async () => {
        const newBaseURI = "https://token-cdn-domain/v2/{id}.json";

        await erc1238Mock.setBaseURI(newBaseURI);

        expect(await erc1238Mock.baseURI()).to.eq(newBaseURI);
      });

      it("should set an empty base URI", async () => {
        await erc1238Mock.setBaseURI("");

        expect(await erc1238Mock.baseURI()).to.eq("");
      });
    });
  });
});
