#include <juce_audio_devices/juce_audio_devices.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_audio_processors/juce_audio_processors.h>
#include <juce_core/juce_core.h>
#include <iostream>
#include <string>

/**
 * Isolated out-of-process JUCE host for AUDIO STUDIO PRO.
 * Communicates via line-delimited JSON over stdin/stdout so third-party
 * VST3 crashes never bring down the main Electron application.
 */
int main()
{
    juce::ScopedJuceInitialiser_GUI juceInit;
    juce::AudioDeviceManager deviceManager;
    juce::AudioPluginFormatManager formatManager;
    formatManager.addDefaultFormats();

    std::string line;
    while (std::getline(std::cin, line))
    {
        auto parsed = juce::JSON::parse(line);
        if (!parsed.isObject())
        {
            std::cout << "{\"ok\":false,\"error\":\"Invalid JSON\"}" << std::endl;
            continue;
        }

        const auto cmd = parsed["cmd"].toString();
        if (cmd == "ping")
        {
            std::cout << "{\"ok\":true,\"host\":\"juce-isolated-v1\"}" << std::endl;
        }
        else if (cmd == "list-devices")
        {
            juce::Array<juce::var> typesOut;
            for (auto* type : deviceManager.getAvailableDeviceTypes())
            {
                type->scanForDevices();
                auto* obj = new juce::DynamicObject();
                obj->setProperty("type", type->getTypeName());
                juce::Array<juce::var> names;
                for (const auto& n : type->getDeviceNames())
                    names.add(n);
                obj->setProperty("devices", names);
                typesOut.add(juce::var(obj));
            }
            auto* res = new juce::DynamicObject();
            res->setProperty("ok", true);
            res->setProperty("drivers", typesOut);
            std::cout << juce::JSON::toString(juce::var(res), true) << std::endl;
        }
        else if (cmd == "process-vst3")
        {
            const auto pluginPath = parsed["pluginPath"].toString();
            const auto inputWav = parsed["inputWav"].toString();
            const auto outputWav = parsed["outputWav"].toString();

            juce::KnownPluginList known;
            juce::OwnedArray<juce::PluginDescription> found;
            for (auto* fmt : formatManager.getFormats())
                fmt->findAllTypesForFile(found, pluginPath);

            if (found.isEmpty())
            {
                std::cout << "{\"ok\":false,\"error\":\"VST3 plugin not found or invalid\"}" << std::endl;
                continue;
            }

            juce::String errMsg;
            auto instance = formatManager.createPluginInstance(*found[0], 48000.0, 512, errMsg);
            if (!instance)
            {
                std::cout << "{\"ok\":false,\"error\":\"" << errMsg.toStdString() << "\"}" << std::endl;
                continue;
            }

            juce::AudioFormatManager afm;
            afm.registerBasicFormats();
            std::unique_ptr<juce::AudioFormatReader> reader(afm.createReaderFor(juce::File(inputWav)));
            if (!reader)
            {
                std::cout << "{\"ok\":false,\"error\":\"Cannot open input WAV\"}" << std::endl;
                continue;
            }

            const int numCh = (int)reader->numChannels;
            const int totalSamples = (int)reader->lengthInSamples;
            juce::AudioBuffer<float> buffer(numCh, totalSamples);
            reader->read(&buffer, 0, totalSamples, 0, true, true);

            instance->prepareToPlay(reader->sampleRate, 512);
            juce::MidiBuffer midi;
            for (int pos = 0; pos < totalSamples; pos += 512)
            {
                const int block = std::min(512, totalSamples - pos);
                juce::AudioBuffer<float> slice(buffer.getArrayOfWritePointers(), numCh, pos, block);
                instance->processBlock(slice, midi);
            }
            instance->releaseResources();

            juce::WavAudioFormat wavFmt;
            juce::File outFile(outputWav);
            outFile.deleteFile();
            std::unique_ptr<juce::FileOutputStream> fos(outFile.createOutputStream());
            if (fos)
            {
                std::unique_ptr<juce::AudioFormatWriter> writer(
                    wavFmt.createWriterFor(fos.get(), reader->sampleRate, (unsigned int)numCh, 32, {}, 0));
                if (writer)
                {
                    fos.release();
                    writer->writeFromAudioSampleBuffer(buffer, 0, totalSamples);
                    std::cout << "{\"ok\":true}" << std::endl;
                    continue;
                }
            }
            std::cout << "{\"ok\":false,\"error\":\"Failed writing output WAV\"}" << std::endl;
        }
        else
        {
            std::cout << "{\"ok\":false,\"error\":\"Unknown command\"}" << std::endl;
        }
    }
    return 0;
}
