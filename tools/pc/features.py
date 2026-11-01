# Which runtime features does the shipped game contain? (searches the exe for UTF-16 class/function names)
import mmap
exe = r"C:\Program Files (x86)\Steam\steamapps\common\EscapeTheBackrooms\EscapeTheBackrooms\Binaries\Win64\Backrooms-Win64-Shipping.exe"
names = ["ProceduralMeshComponent", "CreateMeshSection", "CreateMeshSection_LinearColor", "ImportFileAsTexture2D", "ImportBufferAsTexture2D",
         "CreateDynamicMaterialInstance", "SetTextureParameterValue", "CineCameraActor", "SetViewTargetWithBlend", "LevelSequencePlayer",
         "RuntimeAudioImporter", "SoundWaveProcedural", "ImportSoundFile", "MediaPlayer", "PlaySound2D", "SpawnSoundAtLocation",
         "InvAddByName", "KillPlayer", "ApplyDamage", "Die", "AddToInventory", "SpawnSound2D"]
f = open(exe, 'rb'); mm = mmap.mmap(f.fileno(), 0, access=mmap.ACCESS_READ)
for n in names:
    a = mm.find(n.encode('utf-16-le')) >= 0
    b = mm.find(n.encode('ascii') + b'\x00') >= 0
    print(f"{n:32} utf16={a} ascii={b}")
