"""Export pretrained official YAMNet as TF.js Layers; recorded-audio reference.
Architecture: tensorflow/models/research/audioset/yamnet (Apache-2.0).
Requires tensorflow==2.20.0 tf-keras==2.20.1 h5py==3.14.0.
"""
import hashlib, io, json, pathlib, urllib.request, wave
import numpy as np
import tensorflow as tf
import tf_keras as keras
ROOT=pathlib.Path(__file__).resolve().parents[1]
OUT=ROOT/'public/models/yamnet'
OUT.mkdir(parents=True,exist_ok=True)
CACHE=ROOT/'../../../tmp/yamnet-assets'
CACHE.mkdir(parents=True,exist_ok=True)
def download(url,path):
    if not path.exists():
        with urllib.request.urlopen(url,timeout=120) as response:
            path.write_bytes(response.read())
    return path.read_bytes()
weights=CACHE/'yamnet.h5'
download('https://storage.googleapis.com/audioset/yamnet.h5',weights)
(OUT/'yamnet_class_map.csv').write_bytes(download('https://raw.githubusercontent.com/tensorflow/models/master/research/audioset/yamnet/yamnet_class_map.csv',CACHE/'yamnet_class_map.csv'))
x=keras.layers.Input(shape=(96,64),name='patch')
y=keras.layers.Reshape((96,64,1))(x)
def bn(t,name):
    return keras.layers.BatchNormalization(name=name,center=True,scale=False,epsilon=1e-4)(t)
def conv(t,name,stride,filters):
    t=keras.layers.Conv2D(filters,(3,3),strides=stride,padding='same',use_bias=False,name=name+'/conv')(t)
    return keras.layers.ReLU(name=name+'/relu')(bn(t,name+'/conv/bn'))
def separable(t,name,stride,filters):
    t=keras.layers.DepthwiseConv2D((3,3),strides=stride,padding='same',use_bias=False,name=name+'/depthwise_conv')(t)
    t=keras.layers.ReLU(name=name+'/depthwise_conv/relu')(bn(t,name+'/depthwise_conv/bn'))
    t=keras.layers.Conv2D(filters,(1,1),padding='same',use_bias=False,name=name+'/pointwise_conv')(t)
    return keras.layers.ReLU(name=name+'/pointwise_conv/relu')(bn(t,name+'/pointwise_conv/bn'))
y=conv(y,'layer1',2,32)
for i,(stride,filters) in enumerate([(1,64),(2,128),(1,128),(2,256),(1,256),(2,512),(1,512),(1,512),(1,512),(1,512),(1,512),(2,1024),(1,1024)],2):
    y=separable(y,'layer'+str(i),stride,filters)
y=keras.layers.GlobalAveragePooling2D()(y)
y=keras.layers.Dense(521,use_bias=True)(y)
y=keras.layers.Activation('sigmoid')(y)
model=keras.Model(x,y,name='yamnet_patch')
model.load_weights(str(weights))
specs,binary=[],[]
for weight in model.weights:
    array=weight.numpy().astype('<f4')
    specs.append({'name':weight.name.removesuffix(':0'),'shape':list(array.shape),'dtype':'float32'})
    binary.append(array.tobytes())
(OUT/'weights.bin').write_bytes(b''.join(binary))
(OUT/'model.json').write_text(json.dumps({'format':'layers-model','generatedBy':'Jacobs Issue official YAMNet reproducible export','modelTopology':{'keras_version':keras.__version__,'backend':'tensorflow','model_config':json.loads(model.to_json())},'weightsManifest':[{'paths':['weights.bin'],'weights':specs}]}),encoding='utf-8')
recording=download('https://storage.googleapis.com/audioset/speech_whistling2.wav',CACHE/'speech_whistling2.wav')
with wave.open(io.BytesIO(recording)) as wav:
    assert wav.getframerate()==16000 and wav.getsampwidth()==2
    pcm=np.frombuffer(wav.readframes(wav.getnframes()),dtype='<i2').reshape(-1,wav.getnchannels()).mean(axis=1).astype(np.float32)/32768
pcm=pcm[16000:16000+15360]
padded=tf.pad(tf.constant(pcm),[[0,15600-len(pcm)]])
mag=tf.abs(tf.signal.stft(padded,frame_length=400,frame_step=160,fft_length=512))
mel=tf.signal.linear_to_mel_weight_matrix(64,257,16000,125,7500)
patch=tf.math.log(tf.matmul(mag,mel)+0.001).numpy()
scores=model(patch[None],training=False).numpy()[0]
fixtures=ROOT/'src/ai/fixtures'
fixtures.mkdir(parents=True,exist_ok=True)
(fixtures/'yamnet-reference.json').write_text(json.dumps({'source':'https://storage.googleapis.com/audioset/speech_whistling2.wav','pcm':pcm.tolist(),'patch':patch.reshape(-1).tolist(),'scores':scores.tolist()}),encoding='utf-8')
(OUT/'provenance.json').write_text(json.dumps({'weights_source':'https://storage.googleapis.com/audioset/yamnet.h5','weights_sha256':hashlib.sha256(weights.read_bytes()).hexdigest(),'architecture':'https://github.com/tensorflow/models/tree/master/research/audioset/yamnet','reference':'TensorFlow 2.20 official STFT/mel and pretrained Keras network','license':'Apache-2.0 (architecture); retain original notices'},indent=2),encoding='utf-8')
print('Exported',sum(map(len,binary)),'weight bytes; reference top class',int(scores.argmax()))
